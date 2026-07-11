"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const auth_1 = __importDefault(require("./routes/auth"));
const taxpayer_1 = __importDefault(require("./routes/taxpayer"));
const audit_1 = __importDefault(require("./routes/audit"));
const voucher_1 = __importDefault(require("./routes/voucher"));
const import_1 = __importDefault(require("./routes/import"));
const risk_1 = __importDefault(require("./routes/risk"));
const report_1 = __importDefault(require("./routes/report"));
const taxReturn_1 = __importDefault(require("./routes/taxReturn"));
const smartBook_1 = __importDefault(require("./routes/smartBook"));
const app = (0, express_1.default)();
// 跨域支持
app.use((0, cors_1.default)());
// JSON 请求体解析
app.use(express_1.default.json());
// 健康检查
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
});
// 业务路由统一挂载在 /api 前缀下
app.use('/api/auth', auth_1.default);
app.use('/api/taxpayers', taxpayer_1.default);
app.use('/api/audit', audit_1.default);
app.use('/api/imports', import_1.default);
app.use('/api/vouchers', voucher_1.default);
app.use('/api/tax-returns', taxReturn_1.default);
app.use('/api/reports', report_1.default);
app.use('/api/risks', risk_1.default);
app.use('/api/smart-book', smartBook_1.default);
// 生产模式：托管前端网页（静态文件 + SPA 路由回退）
const publicDir = path_1.default.join(__dirname, '..', 'public');
if (fs_1.default.existsSync(publicDir)) {
    app.use(express_1.default.static(publicDir));
    // SPA 回退：所有非 /api 路径都返回 index.html（让前端路由接管）
    app.get('*', (_req, res) => {
        res.sendFile(path_1.default.join(publicDir, 'index.html'));
    });
}
// 404 处理（仅对未匹配的 /api 请求）
app.use('/api', (_req, res) => {
    res.status(404).json({ error: '接口不存在' });
});
// 全局错误处理中间件
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, _req, res, _next) => {
    console.error('[全局错误]', err);
    const message = err instanceof Error ? err.message : '服务器内部错误';
    res.status(500).json({ error: message });
});
exports.default = app;
