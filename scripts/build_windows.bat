@echo off
setlocal

:: Navigate to the project root if the script is run from the scripts directory
cd /d "%~dp0.."

echo Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo Failed to install dependencies.
    pause
    exit /b %errorlevel%
)

echo Checking for Rust...
where cargo >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Rust is not installed or not in PATH.
    echo Please install Rust from https://rustup.rs/ and restart your terminal.
    pause
    exit /b 1
)

echo Building frontend...
call npm run build
if %errorlevel% neq 0 (
    echo Frontend build failed.
    pause
    exit /b %errorlevel%
)

echo Building Tauri application...
call npm run tauri build
if %errorlevel% neq 0 (
    echo Build failed.
    pause
    exit /b %errorlevel%
)

echo Build completed successfully.
pause
