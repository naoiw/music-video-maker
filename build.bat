@echo off
setlocal
set "NO_PAUSE="
set "SKIP_INSTALL="
:args
if "%~1"=="" goto start
if /i "%~1"=="--no-pause" (
    set "NO_PAUSE=1"
    shift
    goto args
)
if /i "%~1"=="--skip-install" (
    set "SKIP_INSTALL=1"
    shift
    goto args
)
echo Unknown option: %~1
exit /b 1
:start
pushd "%~dp0" || exit /b 1
set "RESULT=1"
set "RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc"
set "CARGO_TARGET_DIR=%CD%\src-tauri\target"
if not exist package.json goto fail
if not exist pnpm-lock.yaml goto fail
if not exist src-tauri\Cargo.lock goto fail
where node.exe >nul 2>&1 || goto missing
where pnpm >nul 2>&1 || goto missing
where rustup.exe >nul 2>&1 || goto missing
where ffmpeg.exe >nul 2>&1 || goto missing
where ffprobe.exe >nul 2>&1 || goto missing
set /p NODE_MAJOR=<.node-version
node.exe -e "if(process.versions.node.split('.')[0]!==process.env.NODE_MAJOR)process.exit(1)" || goto missing
rustup.exe run %RUSTUP_TOOLCHAIN% cargo -V || goto missing
ffmpeg.exe -version >nul || goto missing
ffprobe.exe -version >nul || goto missing
call pnpm --version
if errorlevel 1 goto missing
if defined SKIP_INSTALL goto build
call pnpm install --frozen-lockfile
if errorlevel 1 goto fail
:build
call pnpm run desktop:build
if errorlevel 1 goto fail
if not exist "%CARGO_TARGET_DIR%\release\music-video-maker.exe" goto fail
echo.
echo Build complete:
echo "%CARGO_TARGET_DIR%\release\music-video-maker.exe"
set "RESULT=0"
goto finish
:missing
echo Required tools are missing or have an incompatible version.
echo Run setup.bat, then open a new terminal or restart Windows if needed.
goto finish
:fail
echo Build failed. See the error above.
:finish
popd
if not defined NO_PAUSE pause
exit /b %RESULT%
