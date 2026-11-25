// 화면 테마: 자동(기기 설정) / 밝게 / 어둡게
export type Theme = 'auto' | 'light' | 'dark'

export function applyTheme(t: Theme = 'auto') {
  const el = document.documentElement
  if (t === 'auto') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', t)
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#191919' : '#ffffff')
}
