import { useEffect, useState } from 'react'
import { db, updateItem, useSessions } from '../db'
import { useUI } from '../store'
import { ymd } from '../lib/date'
import { fmtMinutes } from '../lib/review'
import {
  dismissFinished,
  elapsedMs,
  fmtClock,
  loadTimerSettings,
  remainingMs,
  saveTimerSettings,
  skipBreak,
  startFocus,
  stopFocus,
  tick,
  toggle,
  useTimer,
  type TimerSettings,
} from '../lib/timer'
import { toggleOccurrenceDone } from '../lib/recur'
import { Icon } from './ui'

/** 화면 오른쪽 아래 집중 타이머 */
export function TimerWidget() {
  const t = useTimer()
  const { showToast, open } = useUI()
  const panel = useUI((s) => s.timerPanel)
  const setPanel = (v: boolean) => useUI.setState({ timerPanel: v })
  const [, force] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  const today = ymd(new Date())
  const todaySessions = useSessions(today, today)
  const todayMin = todaySessions.reduce((s, x) => s + x.minutes, 0)

  // 1초마다 화면 갱신 + 끝났는지 확인
  useEffect(() => {
    const id = setInterval(() => {
      force((n) => n + 1)
      void tick((msg) => showToast(`⏱ ${msg}`))
    }, 1000)
    return () => clearInterval(id)
  }, [showToast])

  // 탭 제목에 남은 시간 표시
  useEffect(() => {
    const base = '내 캘린더'
    document.title = t.phase === 'idle' ? base : `${t.running ? '▶' : '⏸'} ${fmtClock(remainingMs(t))} · ${t.title} — ${base}`
  })

  const active = t.phase !== 'idle'
  if (!active && !t.justFinished && !panel) return null

  const pct = active && t.plannedMs ? Math.min(100, (elapsedMs(t) / t.plannedMs) * 100) : 0
  const isBreak = t.phase === 'break'

  if (active && collapsed)
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="shadow-pop tnum fixed right-4 bottom-4 z-[60] flex items-center gap-2 rounded-full bg-popover px-3.5 py-2 text-[14px] font-semibold"
        title="타이머 펼치기"
      >
        <span className={`h-2 w-2 rounded-full ${t.running ? 'animate-pulse' : ''}`} style={{ background: isBreak ? 'var(--c-green-bar)' : 'var(--danger)' }} />
        {fmtClock(remainingMs(t))}
      </button>
    )

  return (
    <section aria-label="집중 타이머" className="shadow-pop fixed right-4 bottom-4 z-[60] w-[300px] max-w-[calc(100vw-32px)] rounded-[12px] bg-popover p-3.5">
      <header className="flex items-center gap-2">
        <span className="rounded-[4px] px-1.5 py-px text-[12px] font-medium" style={{ background: `var(--c-${isBreak ? 'green' : active ? 'red' : 'gray'}-bg)`, color: `var(--c-${isBreak ? 'green' : active ? 'red' : 'gray'}-text)` }}>
          {isBreak ? t.title : active ? '집중' : '집중 타이머'}
        </span>
        {active && !isBreak && t.itemId ? (
          <button onClick={() => open(t.itemId!)} className="min-w-0 flex-1 truncate text-left text-[13px] font-medium hover:underline" title="항목 열기">
            {t.title}
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] text-fg2">{active && !isBreak ? t.title : `오늘 ${fmtMinutes(todayMin)} · ${todaySessions.length}회`}</span>
        )}
        {active ? (
          <button onClick={() => setCollapsed(true)} className="grid h-6 w-6 place-items-center rounded text-fg3 hover:bg-hover" aria-label="작게 보기" title="작게 보기">
            <Icon name="collapse" size={13} className="-rotate-90" />
          </button>
        ) : (
          <button onClick={() => (setPanel(false), dismissFinished())} className="grid h-6 w-6 place-items-center rounded text-fg3 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={13} />
          </button>
        )}
      </header>

      {t.justFinished && <FinishedPrompt />}

      {active ? (
        <>
          <div className="tnum mt-2 text-center text-[44px] leading-none font-bold tracking-tight">{fmtClock(remainingMs(t))}</div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-active">
            <div className="h-full rounded-full transition-[width] duration-1000 ease-linear" style={{ width: `${pct}%`, background: isBreak ? 'var(--c-green-bar)' : 'var(--danger)' }} />
          </div>
          <div className="mt-3 flex items-center justify-center gap-2">
            <button onClick={toggle} className="flex h-9 items-center gap-1.5 rounded-full bg-fg px-4 text-[14px] font-medium text-bg hover:opacity-90" aria-label={t.running ? '일시정지' : '계속'}>
              {t.running ? '⏸ 일시정지' : '▶ 계속'}
            </button>
            {isBreak ? (
              <button onClick={skipBreak} className="h-9 rounded-full border border-line-strong px-3.5 text-[13px] hover:bg-hover">
                휴식 건너뛰기
              </button>
            ) : (
              <button
                onClick={async () => {
                  const s = useTimer.getState()
                  await stopFocus(true)
                  const m = Math.round(elapsedMs(s) / 60000)
                  showToast(m >= 1 ? `집중 ${m}분을 기록했어요.` : '1분 미만이라 기록하지 않았어요.')
                }}
                className="h-9 rounded-full border border-line-strong px-3.5 text-[13px] hover:bg-hover"
              >
                ■ 끝내기
              </button>
            )}
          </div>
          {!isBreak && <p className="mt-2 text-center text-[11px] text-fg3">F 키로 일시정지/계속 · 멈춘 시간은 기록에서 빠져요</p>}
        </>
      ) : (
        <QuickStart />
      )}
    </section>
  )
}

/** 집중이 끝난 뒤: 할 일을 완료로 표시할지 묻기 */
function FinishedPrompt() {
  const f = useTimer((s) => s.justFinished)!
  const { showToast } = useUI()
  const [task, setTask] = useState<{ done: boolean; isTask: boolean } | null>(null)
  useEffect(() => {
    if (!f.itemId) return setTask(null)
    const [id, date] = f.itemId.split('::')
    void db.items.get(id).then((it) => setTask(it ? { isTask: it.type === 'task', done: date ? !!it.doneDates?.includes(date) : !!it.done } : null))
  }, [f.itemId])
  return (
    <div className="mt-2.5 rounded-[8px] bg-accent-soft px-2.5 py-2 text-[13px]">
      <p>
        <b>{f.title}</b> 집중 {f.minutes}분을 기록했어요 🎉
      </p>
      {task?.isTask && !task.done && (
        <div className="mt-1.5 flex items-center gap-2">
          <span className="flex-1 text-fg2">이 할 일을 끝냈나요?</span>
          <button
            onClick={async () => {
              const [id, date] = f.itemId!.split('::')
              const it = await db.items.get(id)
              if (it && date) await toggleOccurrenceDone({ ...it, id: f.itemId!, occ: { seriesId: id, date } })
              else if (it) await updateItem(id, { done: true, doing: undefined })
              dismissFinished()
              showToast('완료로 표시했어요.')
            }}
            className="rounded-[6px] bg-accent px-2.5 py-0.5 font-medium text-white"
          >
            완료
          </button>
          <button onClick={dismissFinished} className="rounded-[6px] px-1.5 py-0.5 text-fg2 hover:bg-hover">
            아직
          </button>
        </div>
      )}
    </div>
  )
}

/** 쉬는 중이 아닐 때: 바로 시작 + 설정 */
function QuickStart() {
  const [s, setS] = useState<TimerSettings>(loadTimerSettings)
  const selectedId = useUI((x) => x.selectedId)
  const update = (patch: Partial<TimerSettings>) => {
    const next = { ...s, ...patch }
    setS(next)
    saveTimerSettings(next)
  }
  const num = (v: number, key: keyof TimerSettings, min: number, max: number) => (
    <input
      type="number"
      min={min}
      max={max}
      value={v}
      onChange={(e) => update({ [key]: Math.min(max, Math.max(min, Number(e.target.value) || min)) })}
      className="tnum w-12 rounded-[4px] border border-line bg-transparent px-1 py-0.5 text-center outline-none focus:border-accent"
    />
  )
  return (
    <div className="mt-3 flex flex-col gap-3 text-[13px]">
      <div className="flex flex-wrap gap-1.5">
        {[15, 25, 45, 50].map((m) => (
          <button
            key={m}
            onClick={() => {
              update({ focus: m })
              void startFocus(undefined, m)
            }}
            className={`rounded-full px-3 py-1 ${s.focus === m ? 'bg-fg text-bg' : 'border border-line-strong hover:bg-hover'}`}
          >
            ▶ {m}분
          </button>
        ))}
      </div>
      {selectedId && <p className="text-[12px] text-fg3">지금 열려 있는 항목에 집중하려면 상세 화면 위쪽의 ▶ 집중을 누르세요.</p>}
      <details className="text-fg2">
        <summary className="cursor-pointer text-[12px]">타이머 설정</summary>
        <div className="mt-2 grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1.5">
          <span>집중</span>
          <span>{num(s.focus, 'focus', 5, 120)}분</span>
          <span>짧은 휴식</span>
          <span>{num(s.shortBreak, 'shortBreak', 1, 30)}분</span>
          <span>긴 휴식</span>
          <span>{num(s.longBreak, 'longBreak', 5, 60)}분</span>
          <span>긴 휴식 간격</span>
          <span>{num(s.longEvery, 'longEvery', 2, 8)}회마다</span>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={s.autoBreak} onChange={(e) => update({ autoBreak: e.target.checked })} className="accent-[var(--accent)]" />
            집중이 끝나면 휴식 자동 시작
          </label>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={s.sound} onChange={(e) => update({ sound: e.target.checked })} className="accent-[var(--accent)]" />
            끝날 때 소리
          </label>
        </div>
      </details>
    </div>
  )
}
