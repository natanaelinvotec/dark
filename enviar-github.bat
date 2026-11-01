@echo off
rem Manda o codigo deste PC para o GitHub. Dois cliques e pronto.
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\enviar-github.ps1"
pause
