@echo off
rem Instala e configura o Estudio de Canais. Pode rodar de novo sem medo.
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\instalar.ps1"
pause
