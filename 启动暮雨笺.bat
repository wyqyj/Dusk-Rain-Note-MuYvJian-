@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title 暮雨笺 v3.0.0 - 本地启动

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

echo [1/2] 正在构建...
call npm run build
if %errorlevel% neq 0 (
    echo.
    echo [错误] 构建失败，请检查代码
    pause
    exit /b 1
)

echo.
echo [2/2] 正在启动暮雨笺...
echo.
call npx electron .
endlocal
