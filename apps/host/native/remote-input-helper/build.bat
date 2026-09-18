@echo off
setlocal enabledelayedexpansion

echo [Build] Searching for Visual Studio environment...
set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
if not exist "%VCVARS%" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
)
if not exist "%VCVARS%" (
    set "VCVARS=C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
)
if not exist "%VCVARS%" (
    set "VCVARS=C:\Program Files (x86)\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat"
)

if not exist "%VCVARS%" (
    echo [Error] vcvars64.bat not found!
    exit /b 1
)

echo [Build] Initializing MSVC environment via %VCVARS%...
call "%VCVARS%"

cd /d "%~dp0"
taskkill /F /IM doujiao-remote-input.exe >nul 2>&1
if not exist "bin" mkdir "bin"

echo [Build] Compiling doujiao-remote-input.exe...
cl.exe /O2 /W4 /utf-8 /std:c++17 /EHsc src/main.cpp /Fe:bin/doujiao-remote-input.exe user32.lib

if %ERRORLEVEL% NEQ 0 (
    echo [Error] Compilation failed with code %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)

echo [Build] Running self-test...
bin\doujiao-remote-input.exe --self-test
if %ERRORLEVEL% NEQ 0 (
    echo [Error] Self-test failed with code %ERRORLEVEL%
    exit /b %ERRORLEVEL%
)

echo [Build] Successfully built and tested doujiao-remote-input.exe!
exit /b 0
