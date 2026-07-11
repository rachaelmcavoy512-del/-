"use strict";
// 财务报表服务层（Task4）
// 基于已过账凭证（VoucherEntry join Voucher where status in POSTED_STATUSES）实时聚合，
// 不新增缓存表，避免与并行任务 schema 冲突。
//
// POSTED_STATUSES = ['POSTED','RED_VOID']：
//   - POSTED 正常过账凭证
//   - RED_VOID 红冲凭证，已自动过账，金额已取反，同样计入余额聚合
//
// 余额计算说明：不单独存余额表，实时从 VoucherEntry 聚合。
// 借方科目余额 = 累计借方 - 累计贷方；贷方科目反之。
// 统一保留 2 位小数返回 number。
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeBalance = computeBalance;
exports.getBalanceSheet = getBalanceSheet;
exports.getIncomeStatement = getIncomeStatement;
exports.getCashFlowStatement = getCashFlowStatement;
exports.getTrialBalance = getTrialBalance;
exports.getGeneralLedger = getGeneralLedger;
exports.getSubsidiaryLedger = getSubsidiaryLedger;
const client_1 = require("@prisma/client");
const prisma_1 = __importDefault(require("../utils/prisma"));
// ============ 状态常量 ============
// 计入报表的凭证状态：POSTED 与 RED_VOID（红冲已自动过账，金额已取反）
const POSTED_STATUSES = ['POSTED', 'RED_VOID'];
// 货币资金科目编码（库存现金 1001 / 银行存款 1002）
const CASH_CODES = ['1001', '1002'];
// 本年利润 4103、利润分配 4104，用于计算"未分配利润"
const PROFIT_ACCOUNT_CODE = '4103';
const PROFIT_DIST_CODE = '4104';
// ============ 通用辅助 ============
// 左补零到两位（月份）
function pad2(n) {
    return String(n).padStart(2, '0');
}
// 四舍五入保留 2 位小数
function round2(n) {
    return Math.round(n * 100) / 100;
}
// Prisma.Decimal -> number（保留 2 位）
function d2n(d) {
    if (!d)
        return 0;
    return round2(Number(d.toString()));
}
// 某月 1 日 00:00:00.000
function monthStart(year, month) {
    return new Date(year, month - 1, 1, 0, 0, 0, 0);
}
// 某月最后一日 23:59:59.999
function monthEnd(year, month) {
    return new Date(year, month, 0, 23, 59, 59, 999);
}
// 根据 rangeType 计算日期区间 [start, end]
// MONTH：单月；QUARTER：所在季度；YEAR：年初至该月末（本年累计）
function rangeOf(year, period, rangeType) {
    if (rangeType === 'QUARTER') {
        const q = Math.ceil(period / 3);
        const startMonth = (q - 1) * 3 + 1;
        const endMonth = startMonth + 2;
        return {
            start: monthStart(year, startMonth),
            end: monthEnd(year, endMonth),
            label: `${year}年第${q}季度`,
        };
    }
    if (rangeType === 'YEAR') {
        return {
            start: monthStart(year, 1),
            end: monthEnd(year, period),
            label: `${year}年度（截至${pad2(period)}月）`,
        };
    }
    // 默认 MONTH
    return {
        start: monthStart(year, period),
        end: monthEnd(year, period),
        label: `${year}年${pad2(period)}月`,
    };
}
// 按 accountId 聚合已过账凭证的借/贷方发生额（可选日期过滤）
async function aggregateByAccount(subjectId, dateFilter) {
    const rows = await prisma_1.default.voucherEntry.groupBy({
        by: ['accountId'],
        where: {
            voucher: {
                subjectId,
                status: { in: POSTED_STATUSES },
                ...(dateFilter ? { voucherDate: dateFilter } : {}),
            },
        },
        _sum: { debit: true, credit: true },
    });
    const map = new Map();
    for (const r of rows) {
        map.set(r.accountId, {
            debit: r._sum.debit ?? new client_1.Prisma.Decimal(0),
            credit: r._sum.credit ?? new client_1.Prisma.Decimal(0),
        });
    }
    return map;
}
// 按科目余额方向计算带符号余额
// 借方科目：debit - credit；贷方科目：credit - debit
function signedBalance(balanceDirection, debit, credit) {
    return balanceDirection === 'DEBIT' ? debit.sub(credit) : credit.sub(debit);
}
// ============ 统一余额聚合（供外部复用） ============
// 计算一组科目截至某日的余额合计（带符号，按各科目 balanceDirection）
async function computeBalance(subjectId, accountIds, upToEndDate, fromStartDate) {
    if (accountIds.length === 0)
        return 0;
    const accounts = await prisma_1.default.account.findMany({
        where: { id: { in: accountIds }, subjectId },
    });
    const dirMap = new Map(accounts.map((a) => [a.id, a.balanceDirection]));
    const dateFilter = {};
    if (upToEndDate)
        dateFilter.lte = new Date(upToEndDate);
    if (fromStartDate)
        dateFilter.gte = new Date(fromStartDate);
    const agg = await aggregateByAccount(subjectId, Object.keys(dateFilter).length ? dateFilter : undefined);
    let total = new client_1.Prisma.Decimal(0);
    for (const id of accountIds) {
        const dir = dirMap.get(id);
        if (!dir)
            continue;
        const a = agg.get(id);
        if (!a)
            continue;
        total = total.add(signedBalance(dir, a.debit, a.credit));
    }
    return d2n(total);
}
// ============ 资产负债表 ============
// getBalanceSheet(subjectId, year, period)
// 计算截至该月末各科目余额，按 category 归类。
// 资产侧 = ASSET + COST（生产成本/研发支出为在产品，属资产）
// 负债侧 = LIABILITY
// 权益侧 = EQUITY（本年利润 4103、利润分配 4104 合并为"未分配利润"）
// 未分配利润 = 4103 余额 + 4104 余额 + 本年截至期末的净利润（损益类未结转部分）
// 校验：资产合计 = 负债合计 + 所有者权益合计
async function getBalanceSheet(subjectId, year, period) {
    const end = monthEnd(year, period);
    const yearStart = monthStart(year, 1);
    const accounts = await prisma_1.default.account.findMany({
        where: { subjectId },
        orderBy: { code: 'asc' },
    });
    // 截至期末累计发生额
    const cumulative = await aggregateByAccount(subjectId, { lte: end });
    // 本年（年初至期末）发生额，用于计算本年净利润
    const ytd = await aggregateByAccount(subjectId, { gte: yearStart, lte: end });
    // 计算本年净利润 = 收入类余额 - 支出类余额（贷方科目正余额为收入，借方科目正余额为支出）
    let incomeSum = new client_1.Prisma.Decimal(0);
    let expenseSum = new client_1.Prisma.Decimal(0);
    for (const acc of accounts) {
        if (!acc.isLeaf)
            continue;
        if (acc.category === 'INCOME') {
            const a = ytd.get(acc.id);
            if (a)
                incomeSum = incomeSum.add(signedBalance(acc.balanceDirection, a.debit, a.credit));
        }
        else if (acc.category === 'EXPENSE') {
            const a = ytd.get(acc.id);
            if (a)
                expenseSum = expenseSum.add(signedBalance(acc.balanceDirection, a.debit, a.credit));
        }
    }
    const netProfit = incomeSum.sub(expenseSum);
    const assets = [];
    const liabilities = [];
    const equities = [];
    let totalAssets = new client_1.Prisma.Decimal(0);
    let totalLiabilities = new client_1.Prisma.Decimal(0);
    let totalEquity = new client_1.Prisma.Decimal(0);
    // 未分配利润 = 本年利润 + 利润分配 + 本年净利润
    let retained = new client_1.Prisma.Decimal(0);
    const retainedCodes = [PROFIT_ACCOUNT_CODE, PROFIT_DIST_CODE];
    for (const acc of accounts) {
        if (!acc.isLeaf)
            continue;
        const a = cumulative.get(acc.id);
        const debit = a?.debit ?? new client_1.Prisma.Decimal(0);
        const credit = a?.credit ?? new client_1.Prisma.Decimal(0);
        // 按科目类别自然方向计算余额：资产/成本类借方为正，负债/权益类贷方为正
        // 备抵科目（如累计折旧贷方余额、进项税额借方余额）会以负数正确抵减所属类别
        const bal = acc.category === 'ASSET' || acc.category === 'COST'
            ? debit.sub(credit)
            : credit.sub(debit);
        if (acc.category === 'ASSET' || acc.category === 'COST') {
            totalAssets = totalAssets.add(bal);
            // 仅展示非零科目，避免报表过于冗长
            if (!bal.abs().lte(0)) {
                assets.push({ code: acc.code, name: acc.name, balance: d2n(bal), lineNo: 0 });
            }
        }
        else if (acc.category === 'LIABILITY') {
            totalLiabilities = totalLiabilities.add(bal);
            if (!bal.abs().lte(0)) {
                liabilities.push({ code: acc.code, name: acc.name, balance: d2n(bal), lineNo: 0 });
            }
        }
        else if (acc.category === 'EQUITY') {
            if (retainedCodes.includes(acc.code)) {
                retained = retained.add(bal);
            }
            else {
                totalEquity = totalEquity.add(bal);
                if (!bal.abs().lte(0)) {
                    equities.push({ code: acc.code, name: acc.name, balance: d2n(bal), lineNo: 0 });
                }
            }
        }
        // INCOME/EXPENSE 不直接列示于资产负债表，其净额通过"未分配利润"体现
    }
    // 加入"未分配利润"计算行
    retained = retained.add(netProfit);
    totalEquity = totalEquity.add(retained);
    equities.push({
        code: '4103+4104',
        name: '未分配利润',
        balance: d2n(retained),
        lineNo: 0,
        computed: true,
    });
    // 排序：资产/负债按科目编码升序（近似流动性/到期先后）；权益按编码升序
    assets.sort((a, b) => a.code.localeCompare(b.code));
    liabilities.sort((a, b) => a.code.localeCompare(b.code));
    equities.sort((a, b) => a.code.localeCompare(b.code));
    // 分配行次
    assets.forEach((it, i) => (it.lineNo = i + 1));
    liabilities.forEach((it, i) => (it.lineNo = i + 1));
    equities.forEach((it, i) => (it.lineNo = i + 1));
    const totalAssetsN = d2n(totalAssets);
    const totalLiabilitiesN = d2n(totalLiabilities);
    const totalEquityN = d2n(totalEquity);
    const balanced = Math.abs(totalAssetsN - (totalLiabilitiesN + totalEquityN)) < 0.01;
    return {
        assets,
        liabilities,
        equities,
        totalAssets: totalAssetsN,
        totalLiabilities: totalLiabilitiesN,
        totalEquity: totalEquityN,
        balanced,
        periodLabel: `${year}年${pad2(period)}月`,
    };
}
// ============ 利润表 ============
// getIncomeStatement(subjectId, year, period, rangeType)
// rangeType: MONTH 单月 / QUARTER 季度 / YEAR 年度（本年累计至该月末）
// 收入类：主营业务收入、其他业务收入、投资收益、营业外收入
// 支出类：主营业务成本、其他业务成本、税金及附加、销售费用、管理费用、财务费用、营业外支出、所得税费用
async function getIncomeStatement(subjectId, year, period, rangeType) {
    const { start, end, label } = rangeOf(year, period, rangeType);
    const accounts = await prisma_1.default.account.findMany({
        where: { subjectId, category: { in: ['INCOME', 'EXPENSE'] }, isLeaf: true },
        orderBy: { code: 'asc' },
    });
    const agg = await aggregateByAccount(subjectId, { gte: start, lte: end });
    const incomes = [];
    const expenses = [];
    let operatingRevenue = new client_1.Prisma.Decimal(0); // 主营+其他业务收入
    let operatingCost = new client_1.Prisma.Decimal(0); // 主营+其他业务成本
    let taxAndSurcharge = new client_1.Prisma.Decimal(0); // 税金及附加
    let sellingExpense = new client_1.Prisma.Decimal(0); // 销售费用
    let adminExpense = new client_1.Prisma.Decimal(0); // 管理费用
    let finExpense = new client_1.Prisma.Decimal(0); // 财务费用
    let investIncome = new client_1.Prisma.Decimal(0); // 投资收益
    let nonOpIncome = new client_1.Prisma.Decimal(0); // 营业外收入
    let nonOpExpense = new client_1.Prisma.Decimal(0); // 营业外支出
    let incomeTax = new client_1.Prisma.Decimal(0); // 所得税费用
    for (const acc of accounts) {
        const a = agg.get(acc.id);
        const debit = a?.debit ?? new client_1.Prisma.Decimal(0);
        const credit = a?.credit ?? new client_1.Prisma.Decimal(0);
        // 损益类按自然方向取发生净额：收入贷方净额、支出借方净额
        const amount = signedBalance(acc.balanceDirection, debit, credit);
        const amtN = d2n(amount);
        if (acc.category === 'INCOME') {
            incomes.push({ code: acc.code, name: acc.name, amount: amtN });
            if (acc.code === '6001' || acc.code === '6051')
                operatingRevenue = operatingRevenue.add(amount);
            if (acc.code === '6111')
                investIncome = investIncome.add(amount);
            if (acc.code === '6301')
                nonOpIncome = nonOpIncome.add(amount);
        }
        else {
            expenses.push({ code: acc.code, name: acc.name, amount: amtN });
            if (acc.code === '6401' || acc.code === '6402')
                operatingCost = operatingCost.add(amount);
            if (acc.code === '6403')
                taxAndSurcharge = taxAndSurcharge.add(amount);
            if (acc.code === '6601')
                sellingExpense = sellingExpense.add(amount);
            if (acc.code === '6602')
                adminExpense = adminExpense.add(amount);
            if (acc.code === '6603')
                finExpense = finExpense.add(amount);
            if (acc.code === '6711')
                nonOpExpense = nonOpExpense.add(amount);
            if (acc.code === '6801')
                incomeTax = incomeTax.add(amount);
        }
    }
    const periodExpenses = sellingExpense.add(adminExpense).add(finExpense);
    // 营业利润 = 营业收入 - 营业成本 - 税金及附加 - 期间费用 + 投资收益
    const operatingProfit = operatingRevenue
        .sub(operatingCost)
        .sub(taxAndSurcharge)
        .sub(periodExpenses)
        .add(investIncome);
    // 利润总额 = 营业利润 + 营业外收入 - 营业外支出
    const totalProfit = operatingProfit.add(nonOpIncome).sub(nonOpExpense);
    // 净利润 = 利润总额 - 所得税费用
    const netProfit = totalProfit.sub(incomeTax);
    return {
        incomes,
        expenses,
        operatingRevenue: d2n(operatingRevenue),
        operatingCost: d2n(operatingCost),
        periodExpenses: d2n(periodExpenses),
        operatingProfit: d2n(operatingProfit),
        totalProfit: d2n(totalProfit),
        netProfit: d2n(netProfit),
        periodLabel: label,
    };
}
// ============ 现金流量表 ============
// getCashFlowStatement(subjectId, year, period, rangeType)
// 基于货币资金科目（1001/1002）的凭证分录，按对方科目归类为经营/投资/筹资活动现金流。
// - 货币资金借方发生 = 现金流入；贷方发生 = 现金流出
// - 按同一凭证内对方科目（非货币资金）的类别归类：
//   经营活动：INCOME/EXPENSE/COST，以及营运性资产负债（应收/预付/存货/应付/预收/应交税费/薪酬）
//   投资活动：长期资产（1601 固定资产、1602 累计折旧、5301 研发支出）
//   筹资活动：实收资本 4001、盈余公积 4101、借款 2001 等
async function getCashFlowStatement(subjectId, year, period, rangeType) {
    const { start, end, label } = rangeOf(year, period, rangeType);
    const accounts = await prisma_1.default.account.findMany({ where: { subjectId } });
    const cashAccountIds = new Set(accounts.filter((a) => CASH_CODES.includes(a.code)).map((a) => a.id));
    // 取区间内所有已过账凭证及其分录（含科目信息）
    const vouchers = await prisma_1.default.voucher.findMany({
        where: {
            subjectId,
            status: { in: POSTED_STATUSES },
            voucherDate: { gte: start, lte: end },
        },
        include: {
            entries: { include: { account: true } },
        },
        orderBy: { voucherDate: 'asc' },
    });
    const operating = { inflow: 0, outflow: 0, net: 0, items: [] };
    const investing = { inflow: 0, outflow: 0, net: 0, items: [] };
    const financing = { inflow: 0, outflow: 0, net: 0, items: [] };
    // 活动类型 -> part 映射
    const partMap = {
        operating,
        investing,
        financing,
    };
    // 按对方科目维度归集（便于展示明细）
    const itemMap = new Map();
    for (const v of vouchers) {
        const entries = v.entries;
        // 找出货币资金分录
        const cashEntries = entries.filter((e) => cashAccountIds.has(e.accountId));
        if (cashEntries.length === 0)
            continue;
        // 非货币资金对方分录，用于归类
        const otherEntries = entries.filter((e) => !cashAccountIds.has(e.accountId));
        for (const ce of cashEntries) {
            const inflow = Number(ce.debit.toString()); // 借方 = 流入
            const outflow = Number(ce.credit.toString()); // 贷方 = 流出
            if (inflow <= 0 && outflow <= 0)
                continue;
            let partKey = 'operating';
            let targetCode = '';
            let targetName = '货币资金内部结转';
            if (otherEntries.length > 0) {
                // 选择金额最大的对方分录作为归类依据（简化处理）
                const sorted = [...otherEntries].sort((a, b) => Number(b.debit.add(b.credit).toString()) - Number(a.debit.add(a.credit).toString()));
                const top = sorted[0];
                const acc = top.account;
                targetCode = acc?.code ?? '';
                targetName = acc?.name ?? '其他';
                partKey = classifyActivity(acc?.code ?? '', acc?.category ?? '');
            }
            const part = partMap[partKey];
            part.inflow += inflow;
            part.outflow += outflow;
            // 明细归集
            const key = `${partKey}-${targetCode}`;
            let it = itemMap.get(key);
            if (!it) {
                it = { code: targetCode, name: targetName, inflow: 0, outflow: 0, partKey };
                itemMap.set(key, it);
            }
            it.inflow += inflow;
            it.outflow += outflow;
        }
    }
    // 汇总明细到各 part
    for (const it of itemMap.values()) {
        it.inflow = round2(it.inflow);
        it.outflow = round2(it.outflow);
        partMap[it.partKey].items.push({ code: it.code, name: it.name, inflow: it.inflow, outflow: it.outflow });
    }
    operating.inflow = round2(operating.inflow);
    operating.outflow = round2(operating.outflow);
    operating.net = round2(operating.inflow - operating.outflow);
    investing.inflow = round2(investing.inflow);
    investing.outflow = round2(investing.outflow);
    investing.net = round2(investing.inflow - investing.outflow);
    financing.inflow = round2(financing.inflow);
    financing.outflow = round2(financing.outflow);
    financing.net = round2(financing.inflow - financing.outflow);
    const netChange = round2(operating.net + investing.net + financing.net);
    return { operating, investing, financing, netChange, periodLabel: label };
}
// 按对方科目编码/类别归类现金流活动，返回活动类型 key
// operating 经营活动 / investing 投资活动 / financing 筹资活动
function classifyActivity(code, _category) {
    // 筹资活动：实收资本 4001、资本公积 4002、盈余公积 4101、借款 2001/2002
    if (code === '4001' || code === '4002' || code === '4101' || code.startsWith('2001') || code.startsWith('2002')) {
        return 'financing';
    }
    // 投资活动：固定资产 1601、累计折旧 1602、研发支出 5301、在建工程 1604
    if (code === '1601' || code === '1602' || code === '5301' || code.startsWith('1604')) {
        return 'investing';
    }
    // 其余（INCOME/EXPENSE/COST/营运资产负债）归为经营活动
    return 'operating';
}
// ============ 试算平衡表 / 科目余额表 ============
// getTrialBalance(subjectId, year, period)
// 所有科目期初余额、本期借方发生、本期贷方发生、期末余额。
// 期初/期末按余额方向拆分为借/贷列；校验借方合计 = 贷方合计。
async function getTrialBalance(subjectId, year, period) {
    const start = monthStart(year, period);
    const end = monthEnd(year, period);
    const accounts = await prisma_1.default.account.findMany({
        where: { subjectId, isLeaf: true },
        orderBy: { code: 'asc' },
    });
    // 期初：voucherDate < start
    const opening = await aggregateByAccount(subjectId, { lt: start });
    // 本期发生：start <= voucherDate <= end
    const periodAgg = await aggregateByAccount(subjectId, { gte: start, lte: end });
    const rows = [];
    let totalOpeningDebit = new client_1.Prisma.Decimal(0);
    let totalOpeningCredit = new client_1.Prisma.Decimal(0);
    let totalPeriodDebit = new client_1.Prisma.Decimal(0);
    let totalPeriodCredit = new client_1.Prisma.Decimal(0);
    let totalClosingDebit = new client_1.Prisma.Decimal(0);
    let totalClosingCredit = new client_1.Prisma.Decimal(0);
    for (const acc of accounts) {
        const o = opening.get(acc.id);
        const p = periodAgg.get(acc.id);
        const oDebit = o?.debit ?? new client_1.Prisma.Decimal(0);
        const oCredit = o?.credit ?? new client_1.Prisma.Decimal(0);
        const pDebit = p?.debit ?? new client_1.Prisma.Decimal(0);
        const pCredit = p?.credit ?? new client_1.Prisma.Decimal(0);
        // 期初带符号余额
        const openingBal = signedBalance(acc.balanceDirection, oDebit, oCredit);
        // 期末 = 期初 + 本期发生（按方向）
        const closingBal = acc.balanceDirection === 'DEBIT'
            ? openingBal.add(pDebit).sub(pCredit)
            : openingBal.add(pCredit).sub(pDebit);
        // 按余额方向拆借/贷列
        const openingDebit = openingBal.gte(0) && acc.balanceDirection === 'DEBIT' ? openingBal : new client_1.Prisma.Decimal(0);
        const openingCredit = openingBal.gte(0) && acc.balanceDirection === 'CREDIT' ? openingBal : new client_1.Prisma.Decimal(0);
        const closingDebit = closingBal.gte(0) && acc.balanceDirection === 'DEBIT' ? closingBal : new client_1.Prisma.Decimal(0);
        const closingCredit = closingBal.gte(0) && acc.balanceDirection === 'CREDIT' ? closingBal : new client_1.Prisma.Decimal(0);
        totalOpeningDebit = totalOpeningDebit.add(openingDebit);
        totalOpeningCredit = totalOpeningCredit.add(openingCredit);
        totalPeriodDebit = totalPeriodDebit.add(pDebit);
        totalPeriodCredit = totalPeriodCredit.add(pCredit);
        totalClosingDebit = totalClosingDebit.add(closingDebit);
        totalClosingCredit = totalClosingCredit.add(closingCredit);
        rows.push({
            account: {
                id: acc.id,
                code: acc.code,
                name: acc.name,
                category: acc.category,
                balanceDirection: acc.balanceDirection,
            },
            openingDebit: d2n(openingDebit),
            openingCredit: d2n(openingCredit),
            periodDebit: d2n(pDebit),
            periodCredit: d2n(pCredit),
            closingDebit: d2n(closingDebit),
            closingCredit: d2n(closingCredit),
        });
    }
    const totalPeriodDebitN = d2n(totalPeriodDebit);
    const totalPeriodCreditN = d2n(totalPeriodCredit);
    const balanced = Math.abs(totalPeriodDebitN - totalPeriodCreditN) < 0.01;
    return {
        rows,
        totalOpeningDebit: d2n(totalOpeningDebit),
        totalOpeningCredit: d2n(totalOpeningCredit),
        totalPeriodDebit: totalPeriodDebitN,
        totalPeriodCredit: totalPeriodCreditN,
        totalClosingDebit: d2n(totalClosingDebit),
        totalClosingCredit: d2n(totalClosingCredit),
        balanced,
        periodLabel: `${year}年${pad2(period)}月`,
    };
}
// ============ 总账 ============
// getGeneralLedger(subjectId, accountId, year, period, rangeType)
// 某科目按月汇总本期发生额。
// MONTH：单月；QUARTER：季度内各月；YEAR：1 月至 period 各月（本年累计逐月）
async function getGeneralLedger(subjectId, accountId, year, period, rangeType) {
    const account = await prisma_1.default.account.findFirst({ where: { id: accountId, subjectId } });
    if (!account) {
        throw new Error('科目不存在');
    }
    // 确定月份范围
    let months;
    if (rangeType === 'QUARTER') {
        const q = Math.ceil(period / 3);
        const startMonth = (q - 1) * 3 + 1;
        months = [startMonth, startMonth + 1, startMonth + 2];
    }
    else if (rangeType === 'YEAR') {
        months = [];
        for (let m = 1; m <= period; m++)
            months.push(m);
    }
    else {
        months = [period];
    }
    // 期初余额：截至起始月 1 日前；若起始月为 1 月，期初即年初（累计自最早）
    const openingDate = months[0] === 1 ? undefined : { lt: monthStart(year, months[0]) };
    const openingAgg = await aggregateByAccount(subjectId, openingDate);
    const o = openingAgg.get(accountId);
    const openingBalance = signedBalance(account.balanceDirection, o?.debit ?? new client_1.Prisma.Decimal(0), o?.credit ?? new client_1.Prisma.Decimal(0));
    const rows = [];
    let runningBalance = openingBalance;
    let totalDebit = new client_1.Prisma.Decimal(0);
    let totalCredit = new client_1.Prisma.Decimal(0);
    for (const m of months) {
        const agg = await aggregateByAccount(subjectId, {
            gte: monthStart(year, m),
            lte: monthEnd(year, m),
        });
        const a = agg.get(accountId);
        const d = a?.debit ?? new client_1.Prisma.Decimal(0);
        const c = a?.credit ?? new client_1.Prisma.Decimal(0);
        // 按方向累加
        runningBalance =
            account.balanceDirection === 'DEBIT' ? runningBalance.add(d).sub(c) : runningBalance.add(c).sub(d);
        totalDebit = totalDebit.add(d);
        totalCredit = totalCredit.add(c);
        rows.push({
            month: m,
            periodDebit: d2n(d),
            periodCredit: d2n(c),
            closingBalance: d2n(runningBalance),
        });
    }
    const label = rangeType === 'QUARTER'
        ? `${year}年第${Math.ceil(period / 3)}季度`
        : rangeType === 'YEAR'
            ? `${year}年度（1-${pad2(period)}月）`
            : `${year}年${pad2(period)}月`;
    return {
        account: {
            id: account.id,
            code: account.code,
            name: account.name,
            balanceDirection: account.balanceDirection,
        },
        openingBalance: d2n(openingBalance),
        rows,
        closingBalance: d2n(runningBalance),
        totalDebit: d2n(totalDebit),
        totalCredit: d2n(totalCredit),
        periodLabel: label,
    };
}
// ============ 明细账 ============
// getSubsidiaryLedger(subjectId, accountId, from, to)
// 某科目逐笔凭证分录，含期初、本期发生、期末。
async function getSubsidiaryLedger(subjectId, accountId, from, to) {
    const account = await prisma_1.default.account.findFirst({ where: { id: accountId, subjectId } });
    if (!account) {
        throw new Error('科目不存在');
    }
    const fromDate = new Date(from);
    const toDate = new Date(to);
    // 期初余额：截至 from 前
    const openingAgg = await aggregateByAccount(subjectId, { lt: fromDate });
    const o = openingAgg.get(accountId);
    const openingBalance = signedBalance(account.balanceDirection, o?.debit ?? new client_1.Prisma.Decimal(0), o?.credit ?? new client_1.Prisma.Decimal(0));
    // 区间内逐笔分录
    const entries = await prisma_1.default.voucherEntry.findMany({
        where: {
            accountId,
            voucher: {
                subjectId,
                status: { in: POSTED_STATUSES },
                voucherDate: { gte: fromDate, lte: toDate },
            },
        },
        include: { voucher: true },
        orderBy: { voucher: { voucherDate: 'asc' } },
    });
    const resultEntries = [];
    let running = openingBalance;
    let totalDebit = new client_1.Prisma.Decimal(0);
    let totalCredit = new client_1.Prisma.Decimal(0);
    for (const e of entries) {
        const d = e.debit;
        const c = e.credit;
        running =
            account.balanceDirection === 'DEBIT' ? running.add(d).sub(c) : running.add(c).sub(d);
        totalDebit = totalDebit.add(d);
        totalCredit = totalCredit.add(c);
        resultEntries.push({
            voucherId: e.voucherId,
            voucherNo: e.voucher.voucherNo,
            voucherDate: e.voucher.voucherDate.toISOString().slice(0, 10),
            summary: e.summary,
            debit: d2n(d),
            credit: d2n(c),
            balance: d2n(running),
        });
    }
    return {
        account: {
            id: account.id,
            code: account.code,
            name: account.name,
            balanceDirection: account.balanceDirection,
        },
        openingBalance: d2n(openingBalance),
        entries: resultEntries,
        closingBalance: d2n(running),
        totalDebit: d2n(totalDebit),
        totalCredit: d2n(totalCredit),
    };
}
