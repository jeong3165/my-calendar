import { useRef, useState } from 'react'
import { useUI } from '../store'

/** 패널 가장자리를 끌어서 너비 조절 (두 번 누르면 기본값) */
export function Resizer({ edge, value, min, max, onChange, onReset, label }: { edge: 'left' | 'right'; value: number; min: number; max: number; onChange: (w: number) => void; onReset: () => void; label: string }) {
  const start = useRef<{ x: number; w: number } | null>(null)
  const [drag, setDrag] = useState(false)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} — 끌어서 조절, 두 번 누르면 기본값`}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, w: value }
        setDrag(true)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const zoom = useUI.getState().uiScale // 화면 크기를 바꿨으면 그만큼 나눠 준다
        const dx = (e.clientX - start.current.x) / zoom
        onChange(Math.round(Math.min(max, Math.max(min, start.current.w + (edge === 'right' ? dx : -dx)))))
      }}
      onPointerUp={() => {
        start.current = null
        setDrag(false)
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          const d = (e.key === 'ArrowRight') === (edge === 'right') ? 20 : -20
          onChange(Math.min(max, Math.max(min, value + d)))
        }
      }}
      className={`group absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none ${edge === 'right' ? '-right-1' : '-left-1'}`}
    >
      <div className={`mx-auto h-full w-[2px] transition-colors ${drag ? 'bg-accent' : 'bg-transparent group-hover:bg-accent/50 group-focus-visible:bg-accent'}`} />
    </div>
  )
}
