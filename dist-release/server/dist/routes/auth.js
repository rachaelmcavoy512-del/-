"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_1 = require("../middlewares/auth");
const authController_1 = require("../controllers/authController");
const audit_1 = require("../middlewares/audit");
const router = (0, express_1.Router)();
// 用户注册（首次可放开，否则需管理员权限）
router.post('/register', auth_1.optionalAuth, (0, audit_1.logAction)('注册用户', 'user'), authController_1.register);
// 用户登录
router.post('/login', authController_1.login);
// 获取当前用户信息
router.get('/me', auth_1.authenticate, authController_1.me);
exports.default = router;
