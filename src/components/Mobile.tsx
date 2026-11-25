import { MicButton } from './Mic'
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createItem, useItems } from '../db'
import { useUI } from '../store'
import type { Mode, Section } from '../types'
import { relDay, ymd } from '../lib/date'
import { sectionTasks } from '../lib/items'
import { parseQuick, parsedToItem } from '../lib/parse'
import { withProject } from '../lib/projects'
import { repeatLabel } from '../lib/recur'
import { TaskList, sectionTitle } from './TaskList'
import { Icon, type IconName } from './ui'

/* ───────── 아래쪽 탭 바 (휴대폰) ───────── */
const TABS: { m: Mode; label: string; icon: IconName }[] = [
  { m: 'calendar', label: '캘린더', icon: 'calendar' },
  { m: 'tasks', label: '할 일', icon: 'done' },
  { m: 'board', label: '보드', icon: 'board' },
  { m: 'day', label: '하루', icon: 'sun' },
  { m: 'habits', label: '습관', icon: 'flame' },
  { m: 'chat', label: 'AI', icon: 'chat' },
]

export function BottomNav() {
  const { mode, setMode } = useUI()
  return (
    <nav aria-label="보기" className="z-40 flex shrink-0 border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      {TABS.map((t) => {
        const on = mode === t.m
        return (
          <button
            key={t.m}
            onClick={() => setMode(t.m)}
            aria-current={on ? 'page' : undefined}
            className={`flex min-h-[50px] flex-1 flex-col items-center justify-center gap-[1px] text-[10.5px] ${on ? 'font-semibold text-accent' : 'text-fg2'}`}
          >
            <Icon name={t.icon} size={20} />
            {t.label}
          </button>
        )
      })}
    </nav>
  )
}

/** 떠 있는 + 버튼 */
export function Fab() {
  const open = useUI((s) => s.quickAddOpen)
  if (open) return null
  return (
    <button
      onClick={() => useUI.setState({ quickAddOpen: true })}
      aria-label="빠르게 추가"
      className="fixed right-3.5 bottom-[calc(64px+env(safe-area-inset-bottom))] z-40 grid h-[52px] w-[52px] place-items-center rounded-full bg-accent text-white shadow-[0_6px_20px_rgba(35,131,226,0.45)] active:scale-95"
    >
      <Icon name="plus" size={24} />
    </button>
  )
}

/** 아래에서 올라오는 빠른 추가 창 */
export function QuickAddSheet() {
  const { setDate, showToast } = useUI()
  const close = () => useUI.setState({ quickAddOpen: false, quickAddVoice: false })
  const [voice] = useState(() => useUI.getState().quickAddVoice)
  const [text, setText] = useState('')
  const [type, setType] = useState<'task' | 'event'>('task')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (voice) return // 음성으로 열면 키보드를 띄우지 않음
    const t = setTimeout(() => ref.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [])
  const p = text.trim() ? parseQuick(text) : null

  async function add() {
    if (!p?.title) return
    let patch = parsedToItem(p, type)
    if (type === 'event' && !patch.start) {
      // 날짜·시간을 안 적은 일정 → 다음 정시 1시간
      const s = new Date()
      s.setHours(Math.min(s.getHours() + 1, 23), 0, 0, 0)
      patch = { ...patch, start: s.toISOString(), end: new Date(s.getTime() + 3600000).toISOString() }
    }
    const it = await createItem({ type, ...(await withProject(patch, p.project)) })
    if (it.start) setDate(new Date(it.start))
    showToast(`${type === 'task' ? '할 일' : '일정'} "${it.title}"을(를) 추가했어요.`)
    setText('')
    ref.current?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') void add()
  }

  return (
    <div className="fixed inset-0 z-[65] flex flex-col justify-end bg-black/30" onClick={close}>
      <div onClick={(e) => e.stopPropagation()} className="rounded-t-[16px] bg-popover px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-pop">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong" />
        <div className="mb-2 flex gap-1 rounded-[8px] bg-hover p-1">
          {(
            [
              ['task', '할 일'],
              ['event', '일정'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setType(k)} className={`h-9 flex-1 rounded-[6px] text-[15px] ${type === k ? 'bg-bg font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={ref}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            enterKeyHint="done"
            placeholder={type === 'task' ? '예: 내일 3시 치과 #건강 !높음' : '예: 금요일 저녁 7시 동창 모임'}
            className="h-12 min-w-0 flex-1 rounded-[10px] border border-line-strong bg-bg px-3.5 text-[16px] outline-none focus:border-accent"
          />
          <MicButton value={text} onChange={setText} onError={showToast} autoStart={voice} size={20} className="h-12 w-12 border border-line-strong" />
          <button onClick={add} disabled={!p?.title} className="h-12 shrink-0 rounded-[10px] bg-accent px-4 text-[16px] font-semibold text-white disabled:opacity-40">
            추가
          </button>
        </div>
        {p && (p.date || p.tags.length > 0 || p.repeat || p.project) && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-[13px] text-fg2">
            {p.date && (
              <Chip>
                📅 {relDay(ymd(p.date))}
                {p.start && ` ${String(p.start.h).padStart(2, '0')}:${String(p.start.m).padStart(2, '0')}`}
              </Chip>
            )}
            {p.repeat && <Chip>↻ {repeatLabel(p.repeat, p.date ? ymd(p.date) : undefined)}</Chip>}
            {p.tags.map((t) => (
              <Chip key={t}>#{t}</Chip>
            ))}
            {p.project && <Chip>📁 {p.project}</Chip>}
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button onClick={() => useUI.setState({ quickAddOpen: false, assistantOpen: true })} className="flex h-11 items-center justify-center gap-1.5 rounded-[10px] bg-hover text-[14px] whitespace-nowrap max-[360px]:text-[13px]">
            <Icon name="sparkle" size={16} className="text-[var(--c-purple-bar)]" /> AI 비서
          </button>
          <button
            onClick={() => {
              useUI.setState({ quickAddOpen: false })
              useUI.getState().openImport()
            }}
            className="flex h-11 items-center justify-center gap-1.5 rounded-[10px] bg-hover text-[14px] whitespace-nowrap max-[360px]:text-[13px]"
          >
            <Icon name="image" size={16} className="text-accent" /> 사진·캡처로 추가
          </button>
        </div>
        <p className="mt-2 text-[12px] text-fg3">연달아 입력할 수 있어요. 바깥을 누르면 닫혀요.</p>
      </div>
    </div>
  )
}
const Chip = ({ children }: { children: ReactNode }) => <span className="rounded-[6px] bg-hover px-2 py-0.5">{children}</span>

/* ───────── 휴대폰 '할 일' 화면 ───────── */
const SECTIONS: Section[] = [{ kind: 'today' }, { kind: 'inbox' }, { kind: 'upcoming' }, { kind: 'done' }]

export function MobileTasksView() {
  const { section, setSection } = useUI()
  const items = useItems()
  const cur = section.kind === 'tag' ? SECTIONS[0] : section
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex gap-1 overflow-x-auto px-4 pb-2">
        {SECTIONS.map((s) => {
          const n = s.kind === 'done' ? 0 : sectionTasks(items, s).filter((t) => !t.done).length
          const on = cur.kind === s.kind
          return (
            <button key={s.kind} onClick={() => setSection(s)} className={`flex h-9 shrink-0 items-center gap-1 rounded-full px-3.5 text-[14px] ${on ? 'bg-fg font-semibold text-bg' : 'bg-hover text-fg2'}`}>
              {sectionTitle(s)}
              {n > 0 && <span className={`tnum text-[12px] ${on ? 'opacity-70' : 'text-fg3'}`}>{n}</span>}
            </button>
          )
        })}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-28 [&_li]:py-2 [&_li]:text-[15px]">
        <TaskList section={cur} />
      </div>
    </div>
  )
}
