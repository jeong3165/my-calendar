import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// 파일 하나로 열 때는 외부 파일(아이콘·매니페스트)이 없으므로 아이콘을 HTML 안에 넣는다
const inlineIcon = (): Plugin => ({
  name: 'inline-icon',
  transformIndexHtml(html) {
    const svg = readFileSync('public/icon.svg', 'utf8')
    const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
    return html
      .replace(/<link rel="icon"[^>]*>/, `<link rel="icon" type="image/svg+xml" href="${uri}" />`)
      .replace(/\s*<link rel="(manifest|apple-touch-icon)"[^>]*>/g, '')
  },
})

// 더블클릭으로 바로 열리는 "HTML 파일 하나" 버전 (설치·서버·스크립트 실행 불필요)
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), inlineIcon(), viteSingleFile({ removeViteModuleLoader: true })],
  build: { outDir: 'dist-single', emptyOutDir: true, copyPublicDir: false },
})
