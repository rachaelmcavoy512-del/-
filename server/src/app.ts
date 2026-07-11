import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import authRoutes from './routes/auth';
import taxpayerRoutes from './routes/taxpayer';
import auditRoutes from './routes/audit';
import voucherRoutes from './routes/voucher';
import importRoutes from './routes/import';
import riskRoutes from './routes/risk';
import reportRoutes from './routes/report';
import taxReturnRoutes from './routes/taxReturn';
import smartBookRoutes from './routes/smartBook';

const app = express();

// 跨域支持
app.use(cors());
// JSON 请求体解析
app.use(express.json());

// 健康检查
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

// 业务路由统一挂载在 /api 前缀下
app.use('/api/auth', authRoutes);
app.use('/api/taxpayers', taxpayerRoutes);
app.use('/api/audit', auditRoutes);
app.use('/api/imports', importRoutes);
app.use('/api/vouchers', voucherRoutes);
app.use('/api/tax-returns', taxReturnRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/risks', riskRoutes);
app.use('/api/smart-book', smartBookRoutes);

// 生产模式：托管前端网页（静态文件 + SPA 路由回退）
const publicDir = path.join(__dirname, '..', 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
  // SPA 回退：所有非 /api 路径都返回 index.html（让前端路由接管）
  app.get('*', (_req: Request, res: Response) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

// 404 处理（仅对未匹配的 /api 请求）
app.use('/api', (_req: Request, res: Response) => {
  res.status(404).json({ error: '接口不存在' });
});

// 全局错误处理中间件
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[全局错误]', err);
  const message = err instanceof Error ? err.message : '服务器内部错误';
  res.status(500).json({ error: message });
});

export default app;
