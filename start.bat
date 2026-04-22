@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "package.json" (
  echo [错误] 未找到 package.json，请把本文件放在项目根目录。
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [错误] 未检测到 npm，请先安装 Node.js: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败。
    pause
    exit /b 1
  )
)

echo 正在启动 SpaceViewer...
echo 浏览器打开 http://localhost:5173 （若端口被占用请检查控制台或设置 PORT）
echo 按 Ctrl+C 可停止服务
echo.

call npm start
if errorlevel 1 pause
