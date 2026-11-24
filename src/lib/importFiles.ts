// 가벼운 부분(설정·파일 변환)만 모아 둔 모듈. Anthropic SDK 는 ai.ts 에서 필요할 때만 불러온다.

/* ───────── 설정 (이 브라우저의 localStorage 에만 저장) ───────── */
export const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (가장 정확, 기본값)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (빠르고 저렴)' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (가장 저렴)' },
] as const

export type AISettings = { apiKey: string; model: string }
const KEY = 'my-calendar.ai-settings'

export function loadSettings(): AISettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { apiKey: '', model: MODELS[0].id, ...JSON.parse(raw) }
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return { apiKey: '', model: MODELS[0].id }
}

export function saveSettings(s: AISettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export type ImportSource =
  | { kind: 'image'; name: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string; preview: string }
  | { kind: 'pdf'; name: string; data: string }
  | { kind: 'text'; name: string; text: string }

/* ───────── 파일 → ImportSource ───────── */
const MAX_EDGE = 2000

export async function fileToSource(file: File): Promise<ImportSource> {
  const name = file.name || '붙여넣은 이미지'
  const type = file.type
  if (type.startsWith('image/')) {
    if (/hei[cf]/i.test(type) || /\.hei[cf]$/i.test(name)) throw new Error(`${name}: HEIC 사진은 브라우저에서 열 수 없어요. JPG/PNG로 바꿔서 올려 주세요.`)
    return imageToSource(file, name)
  }
  if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
    if (file.size > 30 * 1024 * 1024) throw new Error(`${name}: PDF가 너무 커요 (30MB 이하).`)
    return { kind: 'pdf', name, data: await toBase64(file) }
  }
  if (type.startsWith('text/') || /\.(txt|md|csv|ics|json|eml)$/i.test(name)) {
    return { kind: 'text', name, text: await file.text() }
  }
  throw new Error(`${name}: 지원하지 않는 형식이에요. 이미지, PDF, 텍스트(.txt .csv .ics) 파일을 올려 주세요.`)
}

/** 큰 사진은 긴 변 2000px 로 줄여서 보낸다 (전송량·비용 절약, API 이미지 한도 준수) */
async function imageToSource(file: File, name: string): Promise<ImportSource> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
  const w = Math.round(bmp.width * scale)
  const h = Math.round(bmp.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bmp, 0, 0, w, h)
  bmp.close()
  // 스크린샷(PNG)은 글자가 선명하도록 PNG 유지, 사진은 JPEG
  const keepPng = file.type === 'image/png' && w * h <= 2_500_000
  const mediaType = keepPng ? 'image/png' : 'image/jpeg'
  const url = canvas.toDataURL(mediaType, 0.9)
  return { kind: 'image', name, mediaType, data: url.split(',')[1], preview: url }
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1])
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
