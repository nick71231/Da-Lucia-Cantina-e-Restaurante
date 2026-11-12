@echo off
chcp 65001 >nul
REM Liga/desliga o servidor como serviço do Windows (sobe sozinho com o computador, escondido).
REM Precisa de administrador: se não estiver, pede a permissão e abre de novo.
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"
:menu
cls
echo ===== Servidor Da Lucia =====
echo.
echo  1 - Instalar (liga sozinho com o Windows)
echo  2 - Reiniciar (depois de atualizar o programa)
echo  3 - Ver se esta funcionando
echo  4 - Desinstalar
echo  5 - Sair
echo.
choice /c 12345 /n /m "Escolha (1-5): "
if errorlevel 5 exit /b
if errorlevel 4 set ACAO=desinstalar& goto rodar
if errorlevel 3 set ACAO=status& goto rodar
if errorlevel 2 set ACAO=reiniciar& goto rodar
set ACAO=instalar
:rodar
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0servico.ps1" %ACAO%
echo.
pause
goto menu
