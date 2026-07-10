import { PrismaClient } from '@prisma/client';

// Prisma 客户端单例，避免开发模式下重复实例化导致连接数过多
const prisma = new PrismaClient();

export default prisma;
