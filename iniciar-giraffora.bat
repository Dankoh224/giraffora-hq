@echo off
REM Abre Giraffora HQ en tu PC: la app (http://localhost:3000) y el worker local.
REM Para que arranque solo al prender el PC: Win+R -> shell:startup -> pega un acceso directo a este archivo.
cd /d "%~dp0"
start "Giraffora HQ - App" cmd /k npm run start
start "Giraffora HQ - Worker" cmd /k npm run worker
timeout /t 6 >nul
start http://localhost:3000
