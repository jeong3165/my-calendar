import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // 상대 경로로 빌드 → GitHub Pages(https://아이디.github.io/저장소이름/) 어디에 올려도 동작
  base: './',
  plugins: [react(), tailwindcss()],
})
