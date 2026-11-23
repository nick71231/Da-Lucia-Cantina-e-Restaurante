@echo off
chcp 65001 >nul
title Servidor Da Lucia (nao feche esta janela)
cd /d "%~dp0"
if not exist logs mkdir logs
REM Cópia extra do backup diário (pendrive, outro disco ou pasta da nuvem). Tire o REM e ajuste o caminho:
set "BACKUP_EXTRA=C:\Users\daluc\OneDrive\Backup Sistema Da Lucia"
:inicio
echo [%date% %time%] Iniciando o servidor...
echo [%date% %time%] Iniciando o servidor... >> logs\servidor.log
node server.js 2>> logs\erros.log
echo [%date% %time%] O servidor parou. Reiniciando em 5 segundos... (veja logs\erros.log)
echo [%date% %time%] O servidor parou (codigo %errorlevel%). Reiniciando em 5 segundos... >> logs\servidor.log
REM espera 5 segundos (o "timeout" não funciona quando roda escondido, como serviço)
ping -n 6 127.0.0.1 >nul
goto inicio
