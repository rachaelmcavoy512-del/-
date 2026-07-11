"use strict";
// 科目体系初始化数据
// 基于企业会计准则常用科目，分为一般纳税人标准科目体系与小规模纳税人简化科目体系
//
// 字段说明：
// - code: 科目编码（4 位为一级，6 位为二级，8 位为三级）
// - name: 科目名称
// - direction: 发生额方向 DEBIT 借方 / CREDIT 贷方
// - level: 科目级次 1-4
// - parentCode: 父科目编码（一级科目无）
// - category: 类别 ASSET 资产 / LIABILITY 负债 / EQUITY 所有者权益 / COST 成本 / INCOME 损益收入 / EXPENSE 损益支出
// - balanceDirection: 余额方向 DEBIT/CREDIT
// - isLeaf: 是否末级科目
Object.defineProperty(exports, "__esModule", { value: true });
exports.SMALL_SCALE_ACCOUNTS = exports.GENERAL_TAXPAYER_ACCOUNTS = void 0;
// 一般纳税人标准科目体系
// 与小规模的核心差异：应交税费-应交增值税（222101）下分设销项税额、进项税额、转出未交增值税等明细
exports.GENERAL_TAXPAYER_ACCOUNTS = [
    // ===== 资产类 =====
    { code: '1001', name: '库存现金', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1002', name: '银行存款', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1122', name: '应收账款', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1123', name: '预付账款', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1221', name: '其他应收款', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1401', name: '原材料', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1405', name: '库存商品', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1601', name: '固定资产', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    // 累计折旧为固定资产备抵科目，余额在贷方
    { code: '1602', name: '累计折旧', direction: 'CREDIT', level: 1, category: 'ASSET', balanceDirection: 'CREDIT', isLeaf: true },
    // ===== 负债类 =====
    { code: '2001', name: '短期借款', direction: 'CREDIT', level: 1, category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '2202', name: '应付账款', direction: 'CREDIT', level: 1, category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '2203', name: '预收账款', direction: 'CREDIT', level: 1, category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '2211', name: '应付职工薪酬', direction: 'CREDIT', level: 1, category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    // 应交税费为一级汇总科目，下设二级明细
    { code: '2221', name: '应交税费', direction: 'CREDIT', level: 1, category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: false },
    // 应交税费-应交增值税（一般纳税人分设销项/进项明细）
    { code: '222101', name: '应交增值税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: false },
    { code: '22210101', name: '销项税额', direction: 'CREDIT', level: 3, parentCode: '222101', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    // 进项税额借方发生、借方余额
    { code: '22210102', name: '进项税额', direction: 'DEBIT', level: 3, parentCode: '222101', category: 'LIABILITY', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '22210103', name: '转出未交增值税', direction: 'CREDIT', level: 3, parentCode: '222101', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222102', name: '未交增值税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222103', name: '应交企业所得税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222104', name: '个人所得税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222105', name: '城建税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222106', name: '教育费附加', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222107', name: '地方教育附加', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222108', name: '印花税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    // ===== 所有者权益类 =====
    { code: '4001', name: '实收资本', direction: 'CREDIT', level: 1, category: 'EQUITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '4101', name: '盈余公积', direction: 'CREDIT', level: 1, category: 'EQUITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '4103', name: '本年利润', direction: 'CREDIT', level: 1, category: 'EQUITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '4104', name: '利润分配', direction: 'CREDIT', level: 1, category: 'EQUITY', balanceDirection: 'CREDIT', isLeaf: true },
    // ===== 成本类 =====
    { code: '5001', name: '生产成本', direction: 'DEBIT', level: 1, category: 'COST', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '5301', name: '研发支出', direction: 'DEBIT', level: 1, category: 'COST', balanceDirection: 'DEBIT', isLeaf: true },
    // ===== 损益收入类 =====
    { code: '6001', name: '主营业务收入', direction: 'CREDIT', level: 1, category: 'INCOME', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '6051', name: '其他业务收入', direction: 'CREDIT', level: 1, category: 'INCOME', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '6111', name: '投资收益', direction: 'CREDIT', level: 1, category: 'INCOME', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '6301', name: '营业外收入', direction: 'CREDIT', level: 1, category: 'INCOME', balanceDirection: 'CREDIT', isLeaf: true },
    // ===== 损益支出类 =====
    { code: '6401', name: '主营业务成本', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6402', name: '其他业务成本', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6403', name: '税金及附加', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6601', name: '销售费用', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6602', name: '管理费用', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6603', name: '财务费用', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6711', name: '营业外支出', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6801', name: '所得税费用', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
];
// 小规模纳税人简化科目体系
// 与一般纳税人的核心差异：应交税费-应交增值税（222101）不再分进项/销项明细，
// 仅保留综合应交增值税（小规模不得抵扣进项税额）
exports.SMALL_SCALE_ACCOUNTS = [
    // ===== 资产类 =====
    { code: '1001', name: '库存现金', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1002', name: '银行存款', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1122', name: '应收账款', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1123', name: '预付账款', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1221', name: '其他应收款', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1401', name: '原材料', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1405', name: '库存商品', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1601', name: '固定资产', direction: 'DEBIT', level: 1, category: 'ASSET', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '1602', name: '累计折旧', direction: 'CREDIT', level: 1, category: 'ASSET', balanceDirection: 'CREDIT', isLeaf: true },
    // ===== 负债类 =====
    { code: '2001', name: '短期借款', direction: 'CREDIT', level: 1, category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '2202', name: '应付账款', direction: 'CREDIT', level: 1, category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '2203', name: '预收账款', direction: 'CREDIT', level: 1, category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '2211', name: '应付职工薪酬', direction: 'CREDIT', level: 1, category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '2221', name: '应交税费', direction: 'CREDIT', level: 1, category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: false },
    // 小规模仅设综合应交增值税，不分进项/销项明细
    { code: '222101', name: '应交增值税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222102', name: '未交增值税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222103', name: '应交企业所得税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222104', name: '个人所得税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222105', name: '城建税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222106', name: '教育费附加', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222107', name: '地方教育附加', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '222108', name: '印花税', direction: 'CREDIT', level: 2, parentCode: '2221', category: 'LIABILITY', balanceDirection: 'CREDIT', isLeaf: true },
    // ===== 所有者权益类 =====
    { code: '4001', name: '实收资本', direction: 'CREDIT', level: 1, category: 'EQUITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '4101', name: '盈余公积', direction: 'CREDIT', level: 1, category: 'EQUITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '4103', name: '本年利润', direction: 'CREDIT', level: 1, category: 'EQUITY', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '4104', name: '利润分配', direction: 'CREDIT', level: 1, category: 'EQUITY', balanceDirection: 'CREDIT', isLeaf: true },
    // ===== 成本类 =====
    { code: '5001', name: '生产成本', direction: 'DEBIT', level: 1, category: 'COST', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '5301', name: '研发支出', direction: 'DEBIT', level: 1, category: 'COST', balanceDirection: 'DEBIT', isLeaf: true },
    // ===== 损益收入类 =====
    { code: '6001', name: '主营业务收入', direction: 'CREDIT', level: 1, category: 'INCOME', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '6051', name: '其他业务收入', direction: 'CREDIT', level: 1, category: 'INCOME', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '6111', name: '投资收益', direction: 'CREDIT', level: 1, category: 'INCOME', balanceDirection: 'CREDIT', isLeaf: true },
    { code: '6301', name: '营业外收入', direction: 'CREDIT', level: 1, category: 'INCOME', balanceDirection: 'CREDIT', isLeaf: true },
    // ===== 损益支出类 =====
    { code: '6401', name: '主营业务成本', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6402', name: '其他业务成本', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6403', name: '税金及附加', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6601', name: '销售费用', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6602', name: '管理费用', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6603', name: '财务费用', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6711', name: '营业外支出', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
    { code: '6801', name: '所得税费用', direction: 'DEBIT', level: 1, category: 'EXPENSE', balanceDirection: 'DEBIT', isLeaf: true },
];
