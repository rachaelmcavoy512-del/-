#!/bin/bash
# 记账报税与税务风险监控系统 启动脚本（Mac/Linux）
cd "$(dirname "$0")"
export NODE_ENV=production
export PORT=3001
echo "========================================"
echo "  记账报税与税务风险监控系统"
echo "========================================"
echo "正在启动系统，请稍候..."
echo "启动后会自动打开浏览器"
echo "按 Ctrl+C 可停止系统"
echo ""
node dist/index.js
