@echo off
chcp 65001 >nul
title 记账报税与税务风险监控系统

echo ========================================
echo   记账报税与税务风险监控系统
echo ========================================
echo.
echo 正在启动系统，请稍候...
echo 启动后会自动打开浏览器
echo 关闭此窗口即可停止系统
echo.

cd /d "%~dp0"

set NODE_ENV=production
set PORT=3001

node dist\index.js

pause
