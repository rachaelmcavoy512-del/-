import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import app from './app';
import prisma from './utils/prisma';

const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';

// 自动打开浏览器
function openBrowser(url: string) {
  const platform = process.platform;
  let cmd: string;
  if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else {
    cmd = `xdg-open "${url}"`;
  }
  exec(cmd, () => { /* 忽略打开浏览器的错误 */ });
}

// 首次运行自动初始化数据库
async function ensureDatabase() {
  const dbPath = path.join(__dirname, '..', 'prisma', 'dev.db');
  if (!fs.existsSync(dbPath)) {
    console.log('首次运行，正在初始化数据库...');
    const { PrismaClient } = require('@prisma/client');
    // 触发 schema 同步（prisma db push 效果，通过 SQLite 自动建表）
    // 这里用运行时 exec 执行 prisma 命令确保表结构创建
    const { execSync } = require('child_process');
    const prismaBin = path.join(__dirname, '..', 'node_modules', '.bin', 'prisma');
    try {
      execSync(`"${prismaBin}" db push --skip-generate`, {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
      });
      console.log('数据库表结构创建完成');
    } catch {
      console.error('数据库初始化失败，请手动运行: npx prisma db push');
    }
  }
}

// 首次运行自动写入种子数据（管理员账号 + 风险指标）
async function ensureSeed() {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    console.log('首次运行，正在创建初始管理员账号和风险指标...');
    const bcrypt = require('bcryptjs');
    const { GENERAL_TAXPAYER_ACCOUNTS, SMALL_SCALE_ACCOUNTS } = require('./seed/accounts');
    const { RISK_INDICATORS } = require('./seed/riskIndicators');
    const passwordHash = await bcrypt.hash('admin123', 10);
    await prisma.user.create({
      data: {
        username: 'admin',
        passwordHash,
        role: 'ADMIN',
      },
    });
    for (const ind of RISK_INDICATORS) {
      await prisma.riskIndicator.upsert({
        where: { code: ind.code },
        create: ind,
        update: { plainDescription: ind.plainDescription, fixSteps: ind.fixSteps },
      });
    }
    console.log('初始数据创建完成（账号: admin / 密码: admin123）');
  }
}

async function main() {
  if (isProduction) {
    await ensureDatabase();
  }
  await prisma.$connect();
  if (isProduction) {
    await ensureSeed();
  }
  app.listen(PORT, () => {
    const url = `http://localhost:${PORT}`;
    console.log('');
    console.log('========================================');
    console.log('  记账报税与税务风险监控系统 已启动');
    console.log('========================================');
    console.log(`  打开浏览器访问: ${url}`);
    console.log(`  账号: admin   密码: admin123`);
    console.log('  关闭此窗口即可停止系统');
    console.log('========================================');
    console.log('');
    if (isProduction) {
      // 生产模式延迟2秒后自动打开浏览器
      setTimeout(() => openBrowser(url), 2000);
    }
  });
}

main().catch((err) => {
  console.error('❌ 启动失败:', err);
  process.exit(1);
});
