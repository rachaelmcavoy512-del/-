"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const child_process_1 = require("child_process");
const app_1 = __importDefault(require("./app"));
const prisma_1 = __importDefault(require("./utils/prisma"));
const PORT = process.env.PORT || 3001;
const isProduction = process.env.NODE_ENV === 'production';
// 自动打开浏览器
function openBrowser(url) {
    const platform = process.platform;
    let cmd;
    if (platform === 'win32') {
        cmd = `start "" "${url}"`;
    }
    else if (platform === 'darwin') {
        cmd = `open "${url}"`;
    }
    else {
        cmd = `xdg-open "${url}"`;
    }
    (0, child_process_1.exec)(cmd, () => { });
}
// 首次运行自动初始化数据库
async function ensureDatabase() {
    const dbPath = path_1.default.join(__dirname, '..', 'prisma', 'dev.db');
    if (!fs_1.default.existsSync(dbPath)) {
        console.log('首次运行，正在初始化数据库...');
        const { PrismaClient } = require('@prisma/client');
        // 触发 schema 同步（prisma db push 效果，通过 SQLite 自动建表）
        // 这里用运行时 exec 执行 prisma 命令确保表结构创建
        const { execSync } = require('child_process');
        const prismaBin = path_1.default.join(__dirname, '..', 'node_modules', '.bin', 'prisma');
        try {
            execSync(`"${prismaBin}" db push --skip-generate`, {
                stdio: 'inherit',
                cwd: path_1.default.join(__dirname, '..'),
            });
            console.log('数据库表结构创建完成');
        }
        catch {
            console.error('数据库初始化失败，请手动运行: npx prisma db push');
        }
    }
}
// 首次运行自动写入种子数据（管理员账号 + 风险指标）
async function ensureSeed() {
    const userCount = await prisma_1.default.user.count();
    if (userCount === 0) {
        console.log('首次运行，正在创建初始管理员账号和风险指标...');
        const bcrypt = require('bcryptjs');
        const { GENERAL_TAXPAYER_ACCOUNTS, SMALL_SCALE_ACCOUNTS } = require('./seed/accounts');
        const { RISK_INDICATORS } = require('./seed/riskIndicators');
        const passwordHash = await bcrypt.hash('admin123', 10);
        await prisma_1.default.user.create({
            data: {
                username: 'admin',
                passwordHash,
                role: 'ADMIN',
            },
        });
        for (const ind of RISK_INDICATORS) {
            await prisma_1.default.riskIndicator.upsert({
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
    await prisma_1.default.$connect();
    if (isProduction) {
        await ensureSeed();
    }
    app_1.default.listen(PORT, () => {
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
