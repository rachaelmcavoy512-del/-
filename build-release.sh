#!/bin/bash
# 打包发布脚本：构建前后端 + 整合运行时文件到 dist-release/ 目录
set -e

ROOT="/workspace"
RELEASE="$ROOT/dist-release"

echo "=== 开始打包 ==="

# 清理旧的发布目录
rm -rf "$RELEASE"
mkdir -p "$RELEASE/server"

echo ">>> 1. 安装完整依赖（构建用）..."
cd "$ROOT"
npm install

echo ">>> 2. 生成 Prisma Client..."
cd "$ROOT/server"
npx prisma generate

echo ">>> 3. 编译后端 TypeScript -> JavaScript..."
npm run build

echo ">>> 4. 构建前端（输出到 server/public）..."
cd "$ROOT/web"
npm run build

echo ">>> 5. 整合发布文件..."
# 后端编译产物
cp -r "$ROOT/server/dist" "$RELEASE/server/dist"
# 前端构建产物
cp -r "$ROOT/server/public" "$RELEASE/server/public"
# Prisma schema 和 seed
cp -r "$ROOT/server/prisma" "$RELEASE/server/prisma"
# package.json
cp "$ROOT/server/package.json" "$RELEASE/server/package.json"
# 配置文件
cp "$ROOT/server/.env.example" "$RELEASE/server/.env"
# 启动脚本
cp "$ROOT/server/start.bat" "$RELEASE/start.bat"
cp "$ROOT/server/start.sh" "$RELEASE/start.sh"
chmod +x "$RELEASE/start.sh"

echo ">>> 6. 在发布目录安装生产依赖..."
cd "$RELEASE/server"
npm install --omit=dev

# 删除发布目录里的测试数据库（让用户首次运行自动创建）
rm -f "$RELEASE/server/prisma/dev.db"

echo ">>> 7. 生成使用说明..."
cat > "$RELEASE/使用说明.txt" << 'EOF'
========================================
  记账报税与税务风险监控系统 使用说明
========================================

【首次使用前：安装 Node.js（只需一次）】
1. 打开浏览器访问 https://nodejs.org
2. 下载"LTS 版本"（长期支持版，左边那个绿色按钮）
3. 双击下载的安装包，一路点"下一步"直到安装完成
4. 安装完成后不需要做任何其他操作

【启动系统】
1. 双击"start.bat"（Mac/Linux 双击"start.sh"）
2. 会弹出一个黑色窗口，显示"系统已启动"
3. 稍等2秒会自动打开浏览器
4. 如果浏览器没自动打开，手动在浏览器输入: http://localhost:3001

【登录】
账号: admin
密码: admin123

【使用流程】
1. 首页点"创建公司" → 填公司名 + 税号 + 选类型
2. 菜单"智能记账" → 上传发票 → 点"生成记账" → 点"一键过账"
3. 首页公司卡片点"一键风险体检" → 查看风险报告
4. 风险报告里点"一键整改" → 自动消除风险

【停止系统】
关闭那个黑色窗口即可。

【数据存储】
你的所有数据存在 server/prisma/dev.db 文件里，不会丢失。
如果需要备份，复制这个文件即可。

【给其他人使用】
把整个文件夹拷贝给对方，对方按上面步骤操作即可。
每台电脑的数据是独立的，互不影响。

【技术支持】
如有问题请联系系统管理员。
EOF

echo ""
echo "=== 打包完成 ==="
echo "发布目录: $RELEASE"
echo ""
echo "目录结构:"
ls -la "$RELEASE"
echo ""
echo "将整个 dist-release 文件夹拷贝给用户即可使用。"
