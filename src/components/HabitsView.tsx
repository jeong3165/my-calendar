import { useMemo, useState, type KeyboardEvent } from 'react'
import { addDays, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { createItem, useItems } from '../db'
import { useUI } from '../store'
import type { Item } from '../types'
import { ymd } from '../lib/date'
import { parseQuick, parsedToItem } from '../lib/parse'
import { baseDate, repeatLabel } from '../lib/recur'
import { dailyRatio, habitStats, isHabit, toggleHabitDay, weeksBack, type HabitStats } from '../lib/habits'
import { Checkbox, Icon } from './ui'

const WEEKS = 26
const WD = ['월', '화', '수', '목', '금', '토', '일']

export function HabitsView() {
  const items = useItems()
  const { open, showToast } = useUI()
  const habits = useMemo(() => items.filter(isHabit), [items])
  const stats = useMemo(() => new Map(habits.map((h) => [h.id, habitStats(h)])), [habits])
  const today = ymd(new Date())
  const start = weeksBack(new Date(), WEEKS)
  const overall = useMemo(() => dailyRatio(habits, ymd(start), today), [habits, start, today])
  const todayList = habits.filter((h) => stats.get(h.id)!.dueToday)
  const doneToday = todayList.filter((h) => stats.get(h.id)!.doneToday).length

  if (!habits.length)
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-4 md:px-10">
        <div className="mx-auto max-w-[640px] py-16 text-center">
          <p className="text-[40px]">🔥</p>
          <p className="mt-2 text-[16px] font-semibold">아직 습관이 없어요</p>
          <p className="mt-1 text-[14px] text-fg2">반복 할 일이 습관이 돼요. 아래에 적어 보세요.</p>
          <div className="mt-5 text-left">
            <NewHabit />
          </div>
        </div>
      </div>
    )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 md:px-10">
      <div className="mx-auto flex max-w-[900px] flex-col gap-6 pt-2">
        {/* 오늘 */}
        <section className="rounded-[12px] bg-sidebar p-4">
          <div className="flex items-baseline gap-2">
            <h3 className="text-[15px] font-semibold">오늘의 습관</h3>
            <span className="tnum text-[13px] text-fg2">
              {doneToday}/{todayList.length}
            </span>
            {todayList.length > 0 && doneToday === todayList.length && <span className="text-[13px] text-[var(--c-green-bar)]">모두 끝냈어요 🎉</span>}
          </div>
          {todayList.length === 0 && <p className="mt-2 text-[13px] text-fg3">오늘은 해야 할 습관이 없어요.</p>}
          <ul className="mt-2 grid gap-1 sm:grid-cols-2">
            {todayList.map((h) => {
              const s = stats.get(h.id)!
              return (
                <li key={h.id} className="flex items-center gap-2.5 rounded-[8px] bg-bg px-3 py-2">
                  <Checkbox
                    checked={s.doneToday}
                    onChange={async () => {
                      await toggleHabitDay(h, today)
                      if (!s.doneToday) showToast(`🔥 ${h.title} ${s.current + 1}${unit(h)} 연속!`)
                    }}
                    size={20}
                  />
                  <button onClick={() => open(`${h.id}::${today}`)} className={`min-w-0 flex-1 truncate text-left text-[15px] ${s.doneToday ? 'text-fg3 line-through' : ''}`}>
                    {h.title}
                  </button>
                  <Streak n={s.current} unitLabel={unit(h)} />
                </li>
              )
            })}
          </ul>
        </section>

        {/* 전체 히트맵 */}
        <section>
          <div className="mb-2 flex items-baseline gap-2 px-1">
            <h3 className="text-[15px] font-semibold">최근 {WEEKS}주</h3>
            <span className="text-[12px] text-fg3">진할수록 그날 해야 할 습관을 많이 했어요</span>
          </div>
          <Heatmap
            start={start}
            cell={(d) => {
              const r = overall.get(d)
              if (!r) return { level: -1 }
              return { level: r.done === 0 ? 0 : Math.ceil((r.done / r.due) * 4), title: `${d} · ${r.done}/${r.due}` }
            }}
            color="green"
          />
        </section>

        {/* 습관별 */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center px-1">
            <h3 className="flex-1 text-[15px] font-semibold">습관별 기록</h3>
            <span className="text-[12px] text-fg3">칸을 누르면 그날 체크를 바꿀 수 있어요</span>
          </div>
          {habits
            .slice()
            .sort((a, b) => stats.get(b.id)!.current - stats.get(a.id)!.current)
            .map((h) => (
              <HabitCard key={h.id} h={h} s={stats.get(h.id)!} start={start} onOpen={() => open(h.id)} />
            ))}
          <NewHabit />
        </section>
      </div>
    </div>
  )
}

const unit = (h: Item) => (h.repeat?.freq === 'weekly' ? '회' : h.repeat?.freq === 'monthly' ? '개월' : h.repeat?.freq === 'yearly' ? '년' : '일')

function Streak({ n, unitLabel }: { n: number; unitLabel: string }) {
  if (n < 1) return <span className="shrink-0 text-[12px] text-fg3">🔥 0</span>
  return (
    <span className={`tnum shrink-0 text-[13px] font-semibold ${n >= 7 ? 'text-danger' : 'text-[var(--c-orange-bar)]'}`} title={`${n}${unitLabel} 연속`}>
      🔥 {n}
    </span>
  )
}

function HabitCard({ h, s, start, onOpen }: { h: Item; s: HabitStats; start: Date; onOpen: () => void }) {
  const today = ymd(new Date())
  const sched = useMemo(() => new Set(s.scheduled), [s.scheduled])
  const [busy, setBusy] = useState(false)
  return (
    <article className="rounded-[12px] border border-line p-4">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button onClick={onOpen} className="min-w-0 text-left text-[15px] font-semibold hover:underline">
          {h.title || '제목 없음'}
        </button>
        <span className="flex items-center gap-1 text-[12px] text-fg3">
          <Icon name="repeat" size={12} />
          {repeatLabel(h.repeat!, baseDate(h))}
        </span>
        <span className="flex-1" />
        <span className="flex items-center gap-3 text-[13px]">
          <span title="지금 이어지는 연속 기록">
            <Streak n={s.current} unitLabel={unit(h)} /> <span className="text-fg3">연속</span>
          </span>
          <span className="text-fg2">
            최고 <b className="tnum text-fg">{s.best}</b>
          </span>
          <span className="text-fg2">
            30일 <b className="tnum text-fg">{s.rate30 === null ? '—' : `${Math.round(s.rate30 * 100)}%`}</b>
          </span>
          <span className="hidden text-fg2 sm:inline">
            총 <b className="tnum text-fg">{s.total}</b>번
          </span>
        </span>
      </header>
      <div className="mt-3">
        <Heatmap
          start={start}
          color={h.color === 'gray' ? 'green' : h.color}
          cell={(d) => {
            if (!sched.has(d)) return { level: -1 }
            const done = s.done.has(d)
            return { level: done ? 4 : 0, title: `${format(new Date(d + 'T00:00:00'), 'M월 d일 (EEE)', { locale: ko })} · ${done ? '했어요 ✓' : d === today ? '오늘 아직' : '못 했어요'}`, clickable: true, today: d === today }
          }}
          onClick={async (d) => {
            if (busy) return
            setBusy(true)
            await toggleHabitDay(h, d)
            setBusy(false)
          }}
        />
      </div>
    </article>
  )
}

type Cell = { level: number; title?: string; clickable?: boolean; today?: boolean }

/** 깃허브 잔디 같은 달력 칸 (가로 = 주, 세로 = 요일) */
function Heatmap({ start, cell, color, onClick }: { start: Date; cell: (d: string) => Cell; color: string; onClick?: (d: string) => void }) {
  const today = ymd(new Date())
  const weeks = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, i) => ymd(addDays(start, w * 7 + i))))
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      <div className="flex shrink-0 flex-col gap-[3px] pt-[18px] text-[10px] leading-[12px] text-fg3">
        {WD.map((w, i) => (
          <span key={w} className="h-3">
            {i % 2 === 0 ? w : ''}
          </span>
        ))}
      </div>
      <div className="flex gap-[3px]">
        {weeks.map((days, w) => (
          <div key={w} className="flex flex-col gap-[3px]">
            {/* 달 이름은 칸 너비에 영향을 주지 않도록 겹쳐서 표시 */}
            <span className="relative h-[15px] w-3">
              {days[0].slice(8) <= '07' && <span className="absolute left-0 text-[10px] leading-[15px] whitespace-nowrap text-fg3">{Number(days[0].slice(5, 7))}월</span>}
            </span>
            {days.map((d) => {
              if (d > today) return <span key={d} className="h-3 w-3" />
              const c = cell(d)
              const style =
                c.level < 0
                  ? { background: 'var(--hover)' }
                  : c.level === 0
                    ? { background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--border-strong)' }
                    : { background: `var(--c-${color}-bar)`, opacity: 0.35 + c.level * 0.16 }
              const El = c.clickable && onClick ? 'button' : 'span'
              return (
                <El
                  key={d}
                  title={c.title ?? d}
                  aria-label={c.title ?? d}
                  onClick={c.clickable && onClick ? () => onClick(d) : undefined}
                  className={`block h-3 w-3 rounded-[3px] ${c.today ? 'ring-1 ring-accent ring-offset-1 ring-offset-bg' : ''} ${c.clickable ? 'cursor-pointer hover:ring-1 hover:ring-fg3' : ''}`}
                  style={style}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

/** 새 습관: 반복을 안 적으면 매일 */
function NewHabit() {
  const [v, setV] = useState('')
  const { showToast } = useUI()
  async function add() {
    const p = parseQuick(v)
    if (!p.title) return
    const patch = parsedToItem(p, 'task')
    const repeat = p.repeat ?? { freq: 'daily' as const, interval: 1 }
    const due = patch.due ?? ymd(new Date())
    await createItem({ type: 'task', ...patch, repeat, due, color: 'green' })
    setV('')
    showToast(`"${p.title}" 습관을 만들었어요.`)
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') void add()
  }
  return (
    <label className="flex items-center gap-2 rounded-[10px] border border-dashed border-line-strong px-3 py-2.5 text-fg3 focus-within:border-accent">
      <Icon name="plus" size={15} />
      <input value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onKey} placeholder="새 습관 (예: 매일 아침 7시 스트레칭, 평일 영어 단어 20개, 매주 월 수 금 러닝)" className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none" />
    </label>
  )
}
