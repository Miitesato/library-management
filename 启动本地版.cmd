@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 阅见 - 本地图书借还管理
echo.
echo   阅见 · 图书借还管理
echo   浏览器访问 http://127.0.0.1:8088
echo   启动后会自动打开浏览器。
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1"
if errorlevel 1 pause
