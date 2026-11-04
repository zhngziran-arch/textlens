@echo off
chcp 65001 >nul
title TextLens - 一键推送到 GitHub
echo ======================================================
echo   TextLens 创作透镜 - 一键推送到 GitHub 仓库
echo   目标仓库: https://github.com/zhngziran-arch/textlens.git
echo ======================================================
echo.
cd /d "%~dp0"
echo 当前目录: %CD%
echo 正在执行 git push ...
git push -u origin main
echo.
if %errorlevel% equ 0 (
    echo ======================================================
    echo   [成功] 代码已全部上传到 GitHub！
    echo   在线体验网址稍后可在仓库 Actions 部署完成后直接访问：
    echo   https://zhngziran-arch.github.io/textlens/
    echo ======================================================
) else (
    echo [提示] 推送未完成，如果提示网络或授权问题，可按窗口提示登录或重试。
)
echo.
pause
