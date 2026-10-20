@echo off
chcp 65001 >nul
title HRM Kassa bijwerken
cd /d "%~dp0"
echo Sluit eerst het kassavenster (start.bat) voordat je bijwerkt.
pause

where git >nul 2>nul
if errorlevel 1 (
  echo Git is niet geinstalleerd. Download van https://git-scm.com
  pause
  exit /b 1
)

echo Backup maken...
if not exist backups mkdir backups
if exist prisma\kassa.db copy /y prisma\kassa.db "backups\voor-update_%date:~-4%%date:~3,2%%date:~0,2%.db" >nul

call git pull || goto :fout
call npm ci || goto :fout
call npx prisma migrate deploy || goto :fout
call npm run build || goto :fout
echo.
echo Klaar. Start de kassa weer met start.bat.
pause
exit /b 0

:fout
echo.
echo Bijwerken mislukt. De kassa en de gegevens zijn niet aangepast; de backup staat in de map backups.
pause
exit /b 1
