@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>nul
cd /d "%~dp0"
title 暮雨笺 v3.0.6 - 创建快捷方式

echo [INFO] 正在创建桌面快捷方式...

set "CURRENT_DIR=%CD%"
set "VBS_FILE=%TEMP%\muyujian-shortcut-%RANDOM%%RANDOM%.vbs"

echo Set oWS = WScript.CreateObject("WScript.Shell") > "%VBS_FILE%"
echo sLinkFile = oWS.SpecialFolders("Desktop") ^& "\暮雨笺.lnk" >> "%VBS_FILE%"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%VBS_FILE%"
echo oLink.TargetPath = "%CURRENT_DIR%\启动暮雨笺.bat" >> "%VBS_FILE%"
echo oLink.WorkingDirectory = "%CURRENT_DIR%" >> "%VBS_FILE%"
echo oLink.Description = "暮雨笺 v3.0.6 - 本地学习工作台" >> "%VBS_FILE%"
echo oLink.WindowStyle = 7 >> "%VBS_FILE%"
echo oLink.Save >> "%VBS_FILE%"

cscript //nologo "%VBS_FILE%"
if %errorlevel% neq 0 (
    echo [错误] 快捷方式创建失败
    del /q "%VBS_FILE%" >nul 2>nul
    pause
    exit /b 1
)
del /q "%VBS_FILE%" >nul 2>nul

echo [OK] 桌面快捷方式已创建
echo.
pause
endlocal
