@echo off
chcp 65001 >nul
rem ── 내 캘린더: 이 PC에서 직접 실행 (Node.js 필요) ──
rem 더블클릭하면 브라우저에서 앱이 열립니다. 창을 닫으면 앱도 꺼집니다.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [안내] Node.js 가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

if not exist node_modules (
  echo 처음 실행이라 필요한 파일을 내려받습니다. 1~2분 걸릴 수 있어요...
  call npm.cmd install
  if errorlevel 1 (
    echo [오류] 설치에 실패했습니다. 회사 네트워크에서 npm 이 막혀 있을 수 있어요.
    pause
    exit /b 1
  )
)

echo 내 캘린더를 시작합니다. 이 창은 닫지 마세요.
call npm.cmd run dev -- --open
pause
