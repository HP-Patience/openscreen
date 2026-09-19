@echo off
setlocal
cd /d E:\openscreen-src
if errorlevel 1 exit /b 1
set "PATH=E:\openscreen-src\.runtime.local;%PATH%"
call npm.cmd run dev -- --host 127.0.0.1
if errorlevel 1 pause
