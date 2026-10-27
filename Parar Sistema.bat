@echo off
taskkill /IM pocketbase.exe /F >nul 2>&1
echo Sistema encerrado.
timeout /t 2 >nul
