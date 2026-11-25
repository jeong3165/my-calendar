import { useEffect, useRef, useState } from 'react'
import { Icon } from './ui'

/* 브라우저 내장 음성 인식 (Chrome·Edge·Safari·안드로이드 크롬). 요금 없음 */
type Rec = {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
}
const Ctor = (): (new () => Rec) | undefined => {
  if (typeof window === 'undefined') return
  const w = window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}
export const speechSupported = () => !!Ctor()

const ERR: Record<string, string> = {
  'not-allowed': '마이크 권한이 막혀 있어요. 주소창의 자물쇠(사이트 설정) → 마이크 → 허용으로 바꿔 주세요.',
  'service-not-allowed': '이 브라우저에서는 음성 인식을 쓸 수 없어요.',
  'no-speech': '말소리가 들리지 않았어요. 다시 눌러 말해 보세요.',
  'audio-capture': '마이크를 찾지 못했어요.',
  network: '음성 인식 서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.',
}

/**
 * 마이크 버튼: 누르고 말하면 입력칸에 글자가 채워짐 (말하는 동안 실시간으로).
 * value/onChange 는 입력칸의 값. 말이 끝나면 onDone 이 불린다.
 */
export function MicButton({
  value,
  onChange,
  onDone,
  onError,
  size = 17,
  className = '',
  autoStart = false,
}: {
  value: string
  onChange: (v: string) => void
  onDone?: (v: string) => void
  onError?: (msg: string) => void
  size?: number
  className?: string
  autoStart?: boolean
}) {
  const [on, setOn] = useState(false)
  const rec = useRef<Rec | null>(null)
  const latest = useRef({ value, onChange, onDone, onError })
  latest.current = { value, onChange, onDone, onError }

  function start() {
    const C = Ctor()
    if (!C) return latest.current.onError?.('이 브라우저는 음성 입력을 지원하지 않아요. Chrome·Edge·Safari를 써 주세요.')
    const r = new C()
    r.lang = 'ko-KR'
    r.interimResults = true
    r.continuous = false
    const base = latest.current.value.trim() ? latest.current.value.trim() + ' ' : ''
    let text = ''
    r.onresult = (e) => {
      text = Array.from(e.results)
        .map((x) => x[0].transcript)
        .join('')
      latest.current.onChange(base + text)
    }
    r.onerror = (e) => {
      if (e.error !== 'aborted') latest.current.onError?.(ERR[e.error] ?? `음성 인식 오류 (${e.error})`)
    }
    r.onend = () => {
      setOn(false)
      rec.current = null
      if (text.trim()) latest.current.onDone?.((base + text).trim())
    }
    try {
      r.start()
      rec.current = r
      setOn(true)
    } catch {
      latest.current.onError?.('음성 인식을 시작하지 못했어요.')
    }
  }
  const stop = () => rec.current?.stop()

  useEffect(() => {
    if (autoStart) start()
    return () => rec.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!speechSupported()) return null
  return (
    <button
      type="button"
      onClick={on ? stop : start}
      className={`relative grid shrink-0 place-items-center rounded-full ${on ? 'bg-danger text-white' : 'text-fg3 hover:bg-hover hover:text-fg2'} ${className}`}
      aria-label={on ? '음성 입력 멈추기' : '말로 입력'}
      aria-pressed={on}
      title={on ? '듣는 중… 누르면 멈춰요' : '말로 입력 (예: 내일 오후 3시 거래처 미팅)'}
    >
      {on && <span className="absolute inset-0 animate-ping rounded-full bg-danger/40" />}
      <Icon name="mic" size={size} className="relative" />
    </button>
  )
}
