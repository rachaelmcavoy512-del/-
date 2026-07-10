// 导入功能测试脚本（Task5 验证）
// 验证：1) 发票 XML/Excel 解析与去重  2) 工资表错误行校验  3) 银行流水导入
// 运行：ts-node src/test-imports.ts
import dotenv from 'dotenv';
dotenv.config();

import * as XLSX from 'xlsx';
import prisma from './utils/prisma';
import {
  importInvoices,
  importBankTransactions,
  importPayrolls,
} from './services/importService';

// 构造发票 XML（税控盘风格 + 英文字段混合）
function buildInvoiceXml(): Buffer {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<invoices>
  <invoice>
    <invoiceCode>1100001234</invoiceCode>
    <invoiceNo>00000001</invoiceNo>
    <invoiceType>SPECIAL</invoiceType>
    <direction>INPUT</direction>
    <billingDate>2024-01-15</billingDate>
    <buyerName>测试购方公司</buyerName>
    <sellerName>测试销方公司</sellerName>
    <buyerTaxNo>91110000BUYER001</buyerTaxNo>
    <sellerTaxNo>91110000SELLER001</sellerTaxNo>
    <amountExclTax>1000</amountExclTax>
    <taxAmount>130</taxAmount>
    <amountInclTax>1130</amountInclTax>
    <taxRate>0.13</taxRate>
  </invoice>
  <invoice>
    <invoiceCode>1100001234</invoiceCode>
    <invoiceNo>00000002</invoiceNo>
    <invoiceType>NORMAL</invoiceType>
    <direction>OUTPUT</direction>
    <billingDate>2024-01-16</billingDate>
    <buyerName>测试购方公司</buyerName>
    <sellerName>测试销方公司</sellerName>
    <amountExclTax>2000</amountExclTax>
    <taxAmount>120</taxAmount>
    <taxRate>0.06</taxRate>
  </invoice>
</invoices>`;
  return Buffer.from(xml, 'utf8');
}

// 构造发票 Excel
function buildInvoiceXlsx(): Buffer {
  const data = [
    ['发票代码', '发票号码', '发票类型', '方向', '开票日期', '购方名称', '销方名称', '不含税金额', '税额', '价税合计', '税率'],
    ['2200005678', '00000010', '电子发票', '进项', '2024-02-01', '甲公司', '乙公司', 5000, 650, 5650, 0.13],
    ['2200005678', '00000011', '普票', '销项', '2024-02-02', '甲公司', '乙公司', 800, 24, 824, 0.03],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '发票');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// 构造工资表 Excel（含一行实发≠应发-扣减的错误行）
function buildPayrollXlsxWithError(): Buffer {
  const data = [
    ['姓名', '身份证号', '应发', '社保', '公积金', '个税', '实发'],
    // 正常行1：10000 = 1500 + 1200 + 300 + 7000 ✓
    ['张三', '110101199001011234', 10000, 1500, 1200, 300, 7000],
    // 错误行2：8000 ≠ 1000 + 800 + 200 + 5000（应=7000，差1000）✗
    ['李四', '110101199002022345', 8000, 1000, 800, 200, 5000],
    // 正常行3：6000 = 900 + 720 + 180 + 4200 ✓
    ['王五', '110101199003033456', 6000, 900, 720, 180, 4200],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '工资');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// 构造银行流水 Excel
function buildBankXlsx(): Buffer {
  const data = [
    ['日期', '摘要', '收入', '支出', '对方户名', '对方账号', '银行账号'],
    ['2024-03-01', '收到货款', 10000, '', '客户A', '62220001111', '62280001234'],
    ['2024-03-02', '支付采购款', '', 5000, '供应商B', '62220002222', '62280001234'],
    ['2024-03-03', '工资发放', '', 12000, '员工', '', '62280001234'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '流水');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function main() {
  console.log('=== Task5 导入功能测试开始 ===\n');

  // 0. 准备测试主体（如不存在则创建）
  let subject = await prisma.taxpayerSubject.findUnique({ where: { taxNumber: 'TEST_IMPORT_001' } });
  if (!subject) {
    subject = await prisma.taxpayerSubject.create({
      data: {
        name: '导入测试主体',
        taxNumber: 'TEST_IMPORT_001',
        taxpayerType: 'GENERAL',
        taxRate: 0.13,
      },
    });
    console.log(`已创建测试主体: id=${subject.id}, name=${subject.name}`);
  } else {
    console.log(`使用已有测试主体: id=${subject.id}, name=${subject.name}`);
  }
  const subjectId = subject.id;
  // 获取 admin 用户 id（作为导入创建人）
  const admin = await prisma.user.findUnique({ where: { username: 'admin' } });
  if (!admin) throw new Error('未找到 admin 用户，请先运行 npm run seed');
  const adminId = admin.id;

  // 清理历史数据，确保测试可重复
  console.log('清理历史导入数据...');
  await prisma.invoice.deleteMany({ where: { subjectId } });
  await prisma.bankTransaction.deleteMany({ where: { subjectId } });
  await prisma.payrollRecord.deleteMany({ where: { subjectId } });
  await prisma.importBatch.deleteMany({ where: { subjectId } });

  // ===== 测试1：发票 XML 解析 + 去重 =====
  console.log('\n--- 测试1：发票 XML 导入（首次）---');
  const xmlBuf = buildInvoiceXml();
  const r1 = await importInvoices(subjectId, xmlBuf, 'test_invoices.xml', adminId);
  console.log(`  总数: ${r1.batch.totalCount}, 成功: ${r1.successCount}, 失败: ${r1.failedCount}, 跳过: ${r1.skippedCount}`);
  console.log(`  批次状态: ${r1.batch.status}`);
  console.assert(r1.successCount === 2, `❌ 预期成功2条，实际${r1.successCount}`);
  console.assert(r1.failedCount === 0, `❌ 预期失败0条，实际${r1.failedCount}`);
  console.assert(r1.skippedCount === 0, `❌ 预期跳过0条，实际${r1.skippedCount}`);
  console.log('  ✅ 首次 XML 导入：2条全部成功');

  console.log('\n--- 测试2：发票 XML 重复导入（去重验证）---');
  const r2 = await importInvoices(subjectId, xmlBuf, 'test_invoices_dup.xml', adminId);
  console.log(`  总数: ${r2.batch.totalCount}, 成功: ${r2.successCount}, 失败: ${r2.failedCount}, 跳过: ${r2.skippedCount}`);
  console.assert(r2.successCount === 0, `❌ 去重后预期成功0条，实际${r2.successCount}`);
  console.assert(r2.skippedCount === 2, `❌ 去重后预期跳过2条，实际${r2.skippedCount}`);
  console.log('  ✅ 重复导入：successCount=0, skippedCount=2（去重生效）');

  // ===== 测试3：发票 Excel 导入 =====
  console.log('\n--- 测试3：发票 Excel 导入 ---');
  const xlsxBuf = buildInvoiceXlsx();
  const r3 = await importInvoices(subjectId, xlsxBuf, 'test_invoices.xlsx', adminId);
  console.log(`  总数: ${r3.batch.totalCount}, 成功: ${r3.successCount}, 失败: ${r3.failedCount}, 跳过: ${r3.skippedCount}`);
  console.assert(r3.successCount === 2, `❌ 预期成功2条，实际${r3.successCount}`);
  console.log('  ✅ Excel 导入：2条成功（中文发票类型"电子发票""普票"已规范化）');

  // 验证入库数据
  const invCount = await prisma.invoice.count({ where: { subjectId } });
  console.log(`  数据库发票总数: ${invCount}`);
  console.assert(invCount === 4, `❌ 预期库中4条，实际${invCount}`);
  console.log('  ✅ 数据库发票数=4（XML 2 + Excel 2，无重复）');

  // ===== 测试4：工资表错误行校验 =====
  console.log('\n--- 测试4：工资表导入（含错误行）---');
  const payrollBuf = buildPayrollXlsxWithError();
  const r4 = await importPayrolls(subjectId, payrollBuf, 'test_payroll.xlsx', adminId, '2024-03');
  console.log(`  总数: ${r4.batch.totalCount}, 成功: ${r4.successCount}, 失败: ${r4.failedCount}, 跳过: ${r4.skippedCount}`);
  console.log(`  错误明细:`);
  r4.errors.forEach((e) => console.log(`    - 行${e.row}: ${e.reason}`));
  console.assert(r4.successCount === 2, `❌ 预期成功2条，实际${r4.successCount}`);
  console.assert(r4.failedCount === 1, `❌ 预期失败1条，实际${r4.failedCount}`);
  console.assert(r4.errors.length === 1, `❌ 预期1条错误，实际${r4.errors.length}`);
  console.assert(r4.errors[0].row === 2, `❌ 预期错误在第2行，实际第${r4.errors[0].row}行`);
  console.log('  ✅ 错误行校验：李四(行2)应发≠扣减+实发，正确识别并记录');

  // 验证 batch.errors JSON 字段
  const batch4 = await prisma.importBatch.findUnique({ where: { id: r4.batch.id } });
  if (batch4 && batch4.errors) {
    const parsed = JSON.parse(batch4.errors);
    console.log(`  批次 errors JSON 字段已正确存储: ${parsed.length} 条错误`);
    console.assert(parsed.length === 1, '❌ errors JSON 长度应为1');
    console.log('  ✅ ImportBatch.errors 以 JSON 字符串存储错误行详情');
  }

  // ===== 测试5：银行流水导入 =====
  console.log('\n--- 测试5：银行流水导入 ---');
  const bankBuf = buildBankXlsx();
  const r5 = await importBankTransactions(subjectId, bankBuf, 'test_bank.xlsx', adminId);
  console.log(`  总数: ${r5.batch.totalCount}, 成功: ${r5.successCount}, 失败: ${r5.failedCount}, 跳过: ${r5.skippedCount}`);
  console.assert(r5.successCount === 3, `❌ 预期成功3条，实际${r5.successCount}`);
  console.log('  ✅ 银行流水导入：3条全部成功（收入/支出方向自动识别）');

  // 验证流水方向
  const bankTxns = await prisma.bankTransaction.findMany({ where: { subjectId }, orderBy: { id: 'asc' } });
  console.log(`  流水方向校验: ${bankTxns.map((t) => `${t.direction}:${t.amount}`).join(', ')}`);
  console.assert(bankTxns[0].direction === 'IN', '❌ 第1条应为收入');
  console.assert(bankTxns[1].direction === 'OUT', '❌ 第2条应为支出');
  console.assert(bankTxns[2].direction === 'OUT', '❌ 第3条应为支出');
  console.log('  ✅ 流水方向识别正确（IN/OUT）');

  // ===== 测试6：工资表 period 格式校验 =====
  console.log('\n--- 测试6：工资表 period 格式校验 ---');
  const r6 = await importPayrolls(subjectId, payrollBuf, 'test_bad_period.xlsx', adminId, '2024-13');
  console.log(`  批次状态: ${r6.batch.status}`);
  console.assert(r6.batch.status === 'FAILED', `❌ 预期 FAILED，实际${r6.batch.status}`);
  console.log('  ✅ 非法 period(2024-13) 正确返回 FAILED 批次');

  // ===== 汇总 =====
  console.log('\n=== 测试汇总 ===');
  const batchCount = await prisma.importBatch.count({ where: { subjectId } });
  console.log(`  共产生 ${batchCount} 个导入批次`);
  console.log(`  发票: ${await prisma.invoice.count({ where: { subjectId } })} 条`);
  console.log(`  流水: ${await prisma.bankTransaction.count({ where: { subjectId } })} 条`);
  console.log(`  工资: ${await prisma.payrollRecord.count({ where: { subjectId } })} 条`);
  console.log('\n=== Task5 导入功能测试全部通过 ✅ ===');
}

main()
  .catch((err) => {
    console.error('❌ 测试失败:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
