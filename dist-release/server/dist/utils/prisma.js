"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
// Prisma 客户端单例，避免开发模式下重复实例化导致连接数过多
const prisma = new client_1.PrismaClient();
exports.default = prisma;
