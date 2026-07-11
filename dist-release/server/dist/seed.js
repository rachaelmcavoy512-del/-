"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma_1 = __importDefault(require("./utils/prisma"));
const riskIndicators_1 = require("./seed/riskIndicators");
// 创建默认账号：admin/admin123（管理员）、accountant/accountant123（会计）
async function main() {
    const adminHash = await bcryptjs_1.default.hash('admin123', 10);
    const accountantHash = await bcryptjs_1.default.hash('accountant123', 10);
    const admin = await prisma_1.default.user.upsert({
        where: { username: 'admin' },
        update: {},
        create: { username: 'admin', passwordHash: adminHash, role: 'ADMIN' },
    });
    const accountant = await prisma_1.default.user.upsert({
        where: { username: 'accountant' },
        update: {},
        create: { username: 'accountant', passwordHash: accountantHash, role: 'ACCOUNTANT' },
    });
    console.log('种子用户已创建:');
    console.log(`  - 管理员: ${admin.username} / admin123 (role=${admin.role})`);
    console.log(`  - 会计:   ${accountant.username} / accountant123 (role=${accountant.role})`);
    // 初始化风险指标库：改用 upsert（按 code），确保已有数据也更新 plainDescription/fixSteps
    for (const ind of riskIndicators_1.RISK_INDICATORS) {
        await prisma_1.default.riskIndicator.upsert({
            where: { code: ind.code },
            create: {
                code: ind.code,
                name: ind.name,
                description: ind.description,
                category: ind.category,
                thresholdHigh: ind.thresholdHigh,
                thresholdMedium: ind.thresholdMedium,
                thresholdLow: ind.thresholdLow ?? null,
                severity: ind.severity,
                enabled: ind.enabled,
                plainDescription: ind.plainDescription,
                fixSteps: ind.fixSteps,
            },
            update: {
                name: ind.name,
                description: ind.description,
                category: ind.category,
                thresholdHigh: ind.thresholdHigh,
                thresholdMedium: ind.thresholdMedium,
                thresholdLow: ind.thresholdLow ?? null,
                severity: ind.severity,
                plainDescription: ind.plainDescription,
                fixSteps: ind.fixSteps,
            },
        });
    }
    console.log(`风险指标库已初始化/更新: ${riskIndicators_1.RISK_INDICATORS.length} 条内置指标`);
}
main()
    .catch((err) => {
    console.error('种子数据创建失败:', err);
    process.exit(1);
})
    .finally(async () => {
    await prisma_1.default.$disconnect();
});
