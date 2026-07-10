import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import prisma from './utils/prisma';

const PORT = process.env.PORT || 3001;

async function main() {
  // 启动前连接数据库
  await prisma.$connect();
  app.listen(PORT, () => {
    console.log(`✅ 服务器已启动: http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('❌ 启动失败:', err);
  process.exit(1);
});
