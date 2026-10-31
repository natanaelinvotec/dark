@echo off
rem Coloca o painel online com Cloudflare Tunnel (veja README, secao "Acesso online").
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\online.ps1"
pause
