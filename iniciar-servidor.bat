@echo off
chcp 65001 >nul
title Servidor Da Lucia (nao feche esta janela)
cd /d "%~dp0"
if not exist logs mkdir logs
REM Cópia extra do backup diário (pendrive, outro disco ou pasta da nuvem). Tire o REM e ajuste o caminho:
REM set BACKUP_EXTRA=D:\Backups-Da-Lucia
:inicio
echo [%date% %time%] Iniciando o servidor...
node server.js 2>> logs\erros.log
echo [%date% %time%] O servidor parou. Reiniciando em 5 segundos... (veja logs\erros.log)
timeout /t 5 /nobreak >nul
goto inicio
