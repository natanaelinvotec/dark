@echo off
rem Liga o painel e o worker e abre o painel no navegador.
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar.ps1"
timeout /t 5 >nul
