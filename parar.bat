@echo off
rem Desliga o painel e o worker.
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\parar.ps1"
timeout /t 3 >nul
