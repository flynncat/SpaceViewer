#!/bin/bash
cd "$(dirname "$0")" || exit 1

if [[ ! -f "package.json" ]]; then
  echo "[错误] 未找到 package.json，请把本文件放在项目根目录。"
  read -r -p "按回车关闭…"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[错误] 未检测到 npm，请先安装 Node.js: https://nodejs.org/"
  read -r -p "按回车关闭…"
  exit 1
fi

if [[ ! -d "node_modules" ]]; then
  echo "首次运行，正在安装依赖..."
  npm install || {
    echo "[错误] npm install 失败。"
    read -r -p "按回车关闭…"
    exit 1
  }
fi

echo "正在启动 SpaceViewer..."
echo "浏览器打开 http://localhost:5173 （若端口被占用请检查终端或设置 PORT）"
echo "按 Ctrl+C 可停止服务"
echo ""

exec npm start
