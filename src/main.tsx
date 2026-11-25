import { applyTheme } from './lib/theme'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// 아이폰·아이패드: 입력칸을 누를 때 화면이 자동 확대되지 않게 (손가락으로 벌리는 확대는 그대로 됨)
if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
  document.querySelector('meta[name=viewport]')?.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1, viewport-fit=cover')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// 배포 버전에서만 서비스 워커 등록 (설치형 앱 + 오프라인)
if (import.meta.env.PROD && location.protocol.startsWith('http') && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}

// 저장된 화면 테마를 먼저 적용 (깜빡임 방지) + 자동일 때 기기 설정이 바뀌면 따라감
try {
  const t = JSON.parse(localStorage.getItem('my-calendar.layout') ?? '{}').theme
  applyTheme(t)
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(JSON.parse(localStorage.getItem('my-calendar.layout') ?? '{}').theme))
} catch {
  /* ignore */
}
