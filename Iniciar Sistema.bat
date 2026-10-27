@echo off
title Sistema de Pareceres
cd /d "%~dp0"
if not exist "pb_data\data.db" (
  echo Preparando o sistema pela primeira vez, aguarde...
  pocketbase.exe superuser upsert admin@pareceres.local Pareceres2026 >nul 2>&1
)
tasklist /FI "IMAGENAME eq pocketbase.exe" 2>nul | find /I "pocketbase.exe" >nul
if errorlevel 1 (
  powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '.\pocketbase.exe' -ArgumentList 'serve','--http=127.0.0.1:8090' -WindowStyle Hidden"
  timeout /t 3 /nobreak >nul
)
start "" "http://127.0.0.1:8090/"
exit
