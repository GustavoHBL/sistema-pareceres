@echo off
REM Sistema de Pareceres - (c) 2026 GustavoHBL. Todos os direitos reservados.
REM Desenvolvido por GustavoHBL - https://github.com/GustavoHBL/sistema-pareceres
title Backup - Sistema de Pareceres
cd /d "%~dp0"
if not exist "pb_data" (
  echo Ainda nao existem dados para copiar.
  pause
  exit /b
)
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HH-mm"') do set DATA=%%i
echo Fechando o sistema para copiar os dados com seguranca...
taskkill /IM pocketbase.exe /F >nul 2>&1
timeout /t 2 /nobreak >nul
if not exist "backups" mkdir "backups"
xcopy "pb_data" "backups\backup_%DATA%\pb_data\" /E /I /Y /Q >nul
echo.
echo Backup criado em: backups\backup_%DATA%
echo Copie a pasta "backups" para um pendrive de vez em quando.
echo.
pause
