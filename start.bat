@echo off
chcp 65001 >nul
title HRM Kassa
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is niet geinstalleerd.
  echo Download de LTS-versie van https://nodejs.org en start daarna opnieuw.
  pause
  exit /b 1
)

node scripts\setup.mjs || goto :fout

if not exist node_modules (
  echo Eerste keer: onderdelen installeren. Dit duurt een paar minuten...
  call npm ci || goto :fout
)

call npx prisma migrate deploy || goto :fout
call npx prisma db seed || goto :fout

if not exist .next\BUILD_ID (
  echo Kassa wordt klaargezet. Eenmalig, 1 tot 2 minuten...
  call npm run build || goto :fout
)

node scripts\info.mjs
start /b "" node scripts\open-browser.mjs
call npm start
pause
exit /b 0

:fout
echo.
echo Er ging iets mis. Maak een foto van dit venster en stuur die door.
pause
exit /b 1
