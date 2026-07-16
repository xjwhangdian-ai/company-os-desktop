#!/bin/bash
# 双击运行：拉取工作台最新代码 → 需要时重装依赖 → 启动开发模式验证
# 关掉应用窗口 / 在终端按 Ctrl+C 即退出
set -e
REPO="$HOME/Code/company-os-desktop"
cd "$REPO"

echo "════════════════════════════════════"
echo " 炬视数字人分身工作台 · 更新并启动"
echo "════════════════════════════════════"

echo ""
echo "▶ 1/3 拉取最新代码 ..."
git pull --rebase || { echo "⚠️  拉取失败（网络或冲突），继续用本地当前版本启动"; }
git log --oneline -1

echo ""
echo "▶ 2/3 检查依赖 ..."
LOCK_MD5=$(md5 -q package-lock.json)
if [ ! -f .last-deps-md5 ] || [ "$LOCK_MD5" != "$(cat .last-deps-md5)" ]; then
  echo "   依赖有变更，重新安装（首次或更新后会慢一些）..."
  npm install
  md5 -q package-lock.json > .last-deps-md5
else
  echo "   依赖无变化，跳过安装"
fi

echo ""
echo "▶ 3/3 启动工作台（开发模式）..."
npm run dev
