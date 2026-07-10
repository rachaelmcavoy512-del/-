import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import prisma from './utils/prisma';
import { RISK_INDICATORS } from './seed/riskIndicators';

// 创建默认账号：admin/admin123（管理员）、accountant/accountant123（会计）
async function main() {
  const adminHash = await bcrypt.hash('admin123', 10);
  const accountantHash = await bcrypt.hash('accountant123', 10);

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', passwordHash: adminHash, role: 'ADMIN' },
  });

  const accountant = await prisma.user.upsert({
    where: { username: 'accountant' },
    update: {},
    create: { username: 'accountant', passwordHash: accountantHash, role: 'ACCOUNTANT' },
  });

  console.log('种子用户已创建:');
  console.log(`  - 管理员: ${admin.username} / admin123 (role=${admin.role})`);
  console.log(`  - 会计:   ${accountant.username} / accountant123 (role=${accountant.role})`);

  // 初始化风险指标库：表为空时插入内置 9 类指标
  const indicatorCount = await prisma.riskIndicator.count();
  if (indicatorCount === 0) {
    await prisma.riskIndicator.createMany({
      data: RISK_INDICATORS.map((ind) => ({
        code: ind.code,
        name: ind.name,
        description: ind.description,
        category: ind.category,
        thresholdHigh: ind.thresholdHigh,
        thresholdMedium: ind.thresholdMedium,
        thresholdLow: ind.thresholdLow ?? null,
        severity: ind.severity,
        enabled: ind.enabled,
      })),
    });
    console.log(`风险指标库已初始化: ${RISK_INDICATORS.length} 条内置指标`);
  } else {
    console.log(`风险指标库已存在 ${indicatorCount} 条，跳过初始化`);
  }
}

main()
  .catch((err) => {
    console.error('种子数据创建失败:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
