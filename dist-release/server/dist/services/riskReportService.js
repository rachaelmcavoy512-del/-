"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateReport = generateReport;
// 风险体检报告服务（新手友好）
// 调用 scanSubject 触发扫描，查 PENDING/IN_PROGRESS 事件，
// 替换 plainDescription 占位符，计算总体评级，按 level 排序
const prisma_1 = __importDefault(require("../utils/prisma"));
const riskScanService_1 = require("./riskScanService");
// 可一键整改的指标编码
const AUTO_FIX_INDICATORS = ['VAT_TAX_BURDEN', 'EXCESS_CREDIT'];
// 替换 plainDescription 中的 {metricValue}/{thresholdValue} 占位符
function fillTemplate(template, metricValue, thresholdValue) {
    if (!template)
        return '';
    return template
        .replace(/\{metricValue\}/g, metricValue)
        .replace(/\{thresholdValue\}/g, thresholdValue ?? '预警值');
}
// 解析 fixSteps JSON 字符串为数组
function parseFixSteps(fixSteps) {
    if (!fixSteps)
        return null;
    try {
        const arr = JSON.parse(fixSteps);
        return Array.isArray(arr) ? arr.map(String) : null;
    }
    catch {
        return null;
    }
}
// 生成风险体检报告
async function generateReport(subjectId, period) {
    const subject = await prisma_1.default.taxpayerSubject.findUnique({ where: { id: subjectId } });
    if (!subject) {
        throw new Error('纳税人主体不存在');
    }
    // 触发扫描（更新/创建命中事件）
    const scanSummary = await (0, riskScanService_1.scanSubject)(subjectId, undefined, period ?? null);
    // 查询活跃事件 PENDING/IN_PROGRESS，含指标信息
    const events = await prisma_1.default.riskEvent.findMany({
        where: {
            subjectId,
            status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
        include: { indicator: true },
        orderBy: [{ level: 'asc' }, { id: 'desc' }],
    });
    // 等级排序权重：HIGH=0, MEDIUM=1, LOW=2
    const levelWeight = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    const sorted = [...events].sort((a, b) => {
        const wa = levelWeight[a.level] ?? 9;
        const wb = levelWeight[b.level] ?? 9;
        return wa - wb;
    });
    const reportEvents = sorted.map((ev) => ({
        id: ev.id,
        indicatorCode: ev.indicator.code,
        indicatorName: ev.indicator.name,
        level: ev.level,
        metricValue: ev.metricValue,
        thresholdValue: ev.thresholdValue,
        plainDescription: fillTemplate(ev.indicator.plainDescription, ev.metricValue, ev.thresholdValue),
        fixSteps: parseFixSteps(ev.indicator.fixSteps),
        suggestion: ev.suggestion,
        status: ev.status,
        canAutoFix: AUTO_FIX_INDICATORS.includes(ev.indicator.code),
        actionableSteps: ev.actionableSteps,
        adjustmentVoucherId: ev.adjustmentVoucherId,
    }));
    // 计算总体评级
    const byLevel = { high: 0, medium: 0, low: 0 };
    for (const ev of reportEvents) {
        if (ev.level === 'HIGH')
            byLevel.high++;
        else if (ev.level === 'MEDIUM')
            byLevel.medium++;
        else if (ev.level === 'LOW')
            byLevel.low++;
    }
    let overallLevel = 'HEALTHY';
    if (byLevel.high > 0)
        overallLevel = 'HIGH';
    else if (byLevel.medium > 0)
        overallLevel = 'MEDIUM';
    else if (byLevel.low > 0)
        overallLevel = 'LOW';
    return {
        subjectId,
        subjectName: subject.name,
        period: scanSummary.period,
        overallLevel,
        totalEvents: reportEvents.length,
        byLevel,
        events: reportEvents,
    };
}
