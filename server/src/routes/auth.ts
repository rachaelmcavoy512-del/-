import { Router } from 'express';
import { optionalAuth, authenticate } from '../middlewares/auth';
import { register, login, me } from '../controllers/authController';
import { logAction } from '../middlewares/audit';

const router = Router();

// 用户注册（首次可放开，否则需管理员权限）
router.post('/register', optionalAuth, logAction('注册用户', 'user'), register);

// 用户登录
router.post('/login', login);

// 获取当前用户信息
router.get('/me', authenticate, me);

export default router;
