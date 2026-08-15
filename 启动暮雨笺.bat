@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
set "MUYUJIAN_PROJECT_DIR=%~dp0"
cd /d "%MUYUJIAN_PROJECT_DIR%"
title 暮雨笺 v3.0.1 - 本地启动

:: 检查 Node.js 是否可用（优先使用系统 PATH）
where node >nul 2>nul
if %errorlevel% neq 0 (
    if exist "C:\tools\node-v22.14.0-win-x64\node.exe" (
        set "PATH=C:\tools\node-v22.14.0-win-x64;%PATH%"
    ) else if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=C:\Program Files\nodejs;%PATH%"
    ) else if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
        set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%"
    ) else (
        echo [错误] 未找到 Node.js，请先安装 Node.js ^(https://nodejs.org^)
        pause
        exit /b 1
    )
)

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

:: 首次启动或依赖目录缺失时自动安装，避免构建后无法找到 Electron 运行时
if not exist "%MUYUJIAN_PROJECT_DIR%node_modules\electron\dist\electron.exe" (
    echo [准备] 正在安装项目依赖，首次启动可能需要几分钟...
    call npm ci
    if errorlevel 1 (
        echo.
        echo [错误] 项目依赖安装失败，请检查网络连接后重试
        pause
        exit /b 1
    )
)

echo [1/2] 正在构建...
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo [错误] 构建失败，请检查代码
    pause
    exit /b 1
)

chcp 65001 >nul 2>nul
:: npm 会重置控制台代码页；此处恢复 UTF-8 以正确处理项目目录中的中文字符。
cd /d "%MUYUJIAN_PROJECT_DIR%"

echo.
echo [2/2] 正在启动暮雨笺...
echo.
if not exist "%MUYUJIAN_PROJECT_DIR%node_modules\electron\dist\electron.exe" (
    echo [错误] Electron 运行时不存在，请重新运行此脚本
    pause
    exit /b 1
)

start "" /b "%MUYUJIAN_PROJECT_DIR%node_modules\electron\dist\electron.exe" .
endlocal
exit /b 0
