@echo off
REM Sistema de Pareceres - (c) 2026 GustavoHBL. Todos os direitos reservados.
REM Desenvolvido por GustavoHBL - https://github.com/GustavoHBL/sistema-pareceres
title Sistema de Pareceres
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\iniciar.ps1"
exit /b
