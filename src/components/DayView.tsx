import { useMemo, useState, type ReactNode } from 'react'
import { addDays, format, startOfWeek } from 'date-fns'
import { ko } from 'date-fns/locale'
import { createItem, saveJournal, useItems, useJournal, useJournals } from '../db'
import { useUI } from '../store'
import type { Item, Journal } from '../types'
import { WEEK, parseYmd, relDay, ymd } from '../lib/date'
import { colorVars, tagColor, taskKey } from '../lib/items'
import { blockMinutes, dayData, fmtMinutes, inboxTasks, moveToDate, moveToInbox, MOOD_LABEL, MOODS, overdueTasks } from '../lib/review'
import { TimeGrid } from './TimeGrid'
import { Checkbox, Icon, toggleDone } from './ui'
import { fmtWhen } from './viewUtil'

export function DayView() {
  const sub = useUI((s) => s.daySub)
  if (sub === 'plan') return <PlanView />
  if (sub === 'week') return <WeekView />
  return <ReviewView />
}

/* ═════════ 아침 계획 ═════════ */
const WORK_MIN = 9 * 60 // 하루 업무 시간 기준 (9시간)

function PlanView() {
  const items = useItems()
  const { isMobile, showToast } = useUI()
  const today = ymd(new Date())
  const tomorrow = ymd(addDays(new Date(), 1))
  const journal = useJournal(today)
  const data = useMemo(() => dayData(items, today), [items, today])
  const overdue = useMemo(() => overdueTasks(items, today), [items, today])
  const inbox = useMemo(() => inboxTasks(items), [items])
  const todayTasks = data.tasks
  const blockMin = todayTasks.filter((t) => !t.done).reduce((s, t) => s + blockMinutes(t), 0)
  const load = Math.min(1, (blockMin + data.eventMinutes) / WORK_MIN)
  const unscheduled = todayTasks.filter((t) => !t.done && !t.start)

  async function confirmPlan() {
    await saveJournal(today, {
      planned: todayTasks.map((t) => t.id),
      plannedMinutes: todayTasks.reduce((s, t) => s + blockMinutes(t), 0),
      plannedAt: new Date().toISOString(),
    })
    showToast(`오늘 계획을 저장했어요. 할 일 ${todayTasks.length}개 · 시간 블록 ${fmtMinutes(blockMin)}`)
  }

  const lists = (
    <div className="flex flex-col gap-5">
      <section className="rounded-[10px] bg-sidebar p-4">
        <p className="text-[15px] font-semibold">
          {new Date().getHours() < 12 ? '좋은 아침이에요 ☀️' : '오늘 계획을 세워 볼까요?'} <span className="font-normal text-fg2">{format(new Date(), 'M월 d일 EEEE', { locale: ko })}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg2">
          <span>
            일정 <b className="text-fg">{data.events.length}</b>개 · {fmtMinutes(data.eventMinutes)}
          </span>
          <span>
            할 일 <b className="text-fg">{todayTasks.filter((t) => !t.done).length}</b>개
          </span>
          <span>
            시간 블록 <b className="text-fg">{fmtMinutes(blockMin)}</b>
          </span>
        </div>
        <div className="mt-2.5" title="일정 + 시간 블록 / 9시간">
          <div className="h-2 overflow-hidden rounded-full bg-active">
            <div className="h-full rounded-full transition-all" style={{ width: `${load * 100}%`, background: load > 0.9 ? 'var(--danger)' : load > 0.7 ? 'var(--c-orange-bar)' : 'var(--accent)' }} />
          </div>
          <p className="mt-1 text-[12px] text-fg3">
            9시간 중 {Math.round(load * 100)}% 채움{load > 0.9 ? ' · 너무 빡빡해요. 몇 개는 내일로 옮겨 보세요.' : ''}
          </p>
        </div>
      </section>

      {overdue.length > 0 && (
        <Block
          title="어제까지 못 끝낸 일"
          count={overdue.length}
          action={
            <button onClick={() => overdue.forEach((t) => void moveToDate(t, today))} className="rounded-[4px] px-1.5 py-0.5 text-[12px] font-medium text-accent hover:bg-hover">
              모두 오늘로
            </button>
          }
        >
          {overdue.map((t) => (
            <PlanRow key={t.id} t={t} meta={<span className="text-danger">{relDay(taskKey(t)!)}</span>}>
              <Act onClick={() => moveToDate(t, today)}>오늘</Act>
              <Act onClick={() => moveToDate(t, tomorrow)}>내일</Act>
              <Act onClick={() => moveToInbox(t)}>인박스</Act>
            </PlanRow>
          ))}
        </Block>
      )}

      {inbox.length > 0 && (
        <Block title="인박스 정리" count={inbox.length} hint="날짜가 없는 할 일이에요">
          {inbox.map((t) => (
            <PlanRow key={t.id} t={t}>
              <Act onClick={() => moveToDate(t, today)}>오늘</Act>
              <Act onClick={() => moveToDate(t, tomorrow)}>내일</Act>
            </PlanRow>
          ))}
        </Block>
      )}

      <Block title="오늘 할 일" count={todayTasks.length} hint={isMobile ? undefined : '오른쪽 시간표로 끌어다 놓으면 시간이 정해져요'}>
        {todayTasks.length === 0 && <p className="px-2 py-2 text-[13px] text-fg3">아직 없어요. 위에서 옮기거나 아래에 적어 보세요.</p>}
        {todayTasks.map((t) => (
          <PlanRow key={t.id} t={t} meta={t.start ? <span>{fmtWhen(t).replace(/^오늘 /, '')}</span> : !t.done ? <span className="text-fg3">시간 미정</span> : undefined}>
            {!t.done && !t.occ && <Act onClick={() => moveToDate(t, tomorrow)}>내일로</Act>}
          </PlanRow>
        ))}
        <QuickTask due={today} />
      </Block>

      <div className="flex flex-wrap items-center gap-3 pb-6">
        <button onClick={confirmPlan} className="rounded-[6px] bg-accent px-4 py-2 text-[14px] font-medium text-white hover:brightness-110">
          {journal?.plannedAt ? '계획 다시 저장' : '오늘 계획 확정'}
        </button>
        <span className="text-[12px] text-fg3">
          {journal?.plannedAt
            ? `${format(new Date(journal.plannedAt), 'HH:mm')}에 저장했어요 · 저녁에 '하루 정리'에서 계획 대비 결과를 볼 수 있어요`
            : `확정하면 지금 목록이 오늘의 계획으로 기록돼요${unscheduled.length ? ` · 시간 미정 ${unscheduled.length}개` : ''}`}
        </span>
      </div>
    </div>
  )

  if (isMobile) return <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2">{lists}</div>
  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-[440px] shrink-0 overflow-y-auto border-r border-line px-5 pt-3 xl:w-[500px]">{lists}</div>
      <div className="flex min-w-0 flex-1 flex-col">
        <TimeGrid days={[parseYmd(today)]} />
      </div>
    </div>
  )
}

function Block({ title, count, hint, action, children }: { title: string; count: number; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <header className="mb-1 flex items-baseline gap-2 px-1">
        <h3 className="text-[14px] font-semibold">{title}</h3>
        <span className="tnum text-[13px] text-fg3">{count}</span>
        {hint && <span className="truncate text-[12px] text-fg3">· {hint}</span>}
        <span className="ml-auto">{action}</span>
      </header>
      <ul className="flex flex-col">{children}</ul>
    </section>
  )
}

function PlanRow({ t, meta, children }: { t: Item; meta?: ReactNode; children?: ReactNode }) {
  const open = useUI((s) => s.open)
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-item', t.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      className="group flex items-center gap-2 rounded-[6px] px-2 py-1.5 hover:bg-hover"
    >
      <Checkbox checked={!!t.done} onChange={() => toggleDone(t)} size={15} />
      <button onClick={() => open(t.id)} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
        <span className={`truncate text-[14px] ${t.done ? 'text-fg3 line-through' : ''}`}>{t.title || '제목 없음'}</span>
        {t.occ && <Icon name="repeat" size={11} className="shrink-0 text-fg3" />}
        {meta && <span className="tnum shrink-0 text-[12px] text-fg2">{meta}</span>}
        {t.priority === 'high' && !t.done && <Icon name="flag" size={11} className="shrink-0 text-danger" />}
      </button>
      <span className="flex shrink-0 gap-0.5 opacity-70 group-hover:opacity-100">{children}</span>
    </li>
  )
}

function Act({ onClick, children }: { onClick: () => unknown; children: ReactNode }) {
  return (
    <button onClick={() => void onClick()} className="rounded-[4px] border border-line px-1.5 py-0.5 text-[12px] text-fg2 hover:border-line-strong hover:bg-bg hover:text-fg">
      {children}
    </button>
  )
}

function QuickTask({ due, placeholder = '할 일 추가', priority }: { due: string; placeholder?: string; priority?: 'high' }) {
  const [v, setV] = useState('')
  return (
    <label className="mt-0.5 flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-fg3 focus-within:bg-hover hover:bg-hover">
      <Icon name="plus" size={14} />
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={async (e) => {
          if (e.nativeEvent.isComposing || e.key !== 'Enter' || !v.trim()) return
          await createItem({ type: 'task', title: v.trim(), due, ...(priority ? { priority } : {}) })
          setV('')
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none"
      />
    </label>
  )
}

/* ═════════ 하루 정리 ═════════ */
function ReviewView() {
  const items = useItems()
  const dayDate = useUI((s) => s.dayDate)
  const date = ymd(dayDate)
  const journal = useJournal(date)
  const d = useMemo(() => dayData(items, date, journal), [items, date, journal])
  const tomorrow = ymd(addDays(dayDate, 1))
  const left = d.planned.filter((p) => !p.done && !p.occ) // 반복 회차는 옮기지 않음

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-24 md:px-6">
      <div className="mx-auto flex max-w-[860px] flex-col gap-6">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Stat label="완료율" value={d.rate === null ? '—' : `${Math.round(d.rate * 100)}%`} sub={d.planned.length ? `${d.hasPlan ? '계획' : '할 일'} ${d.planned.length}개 중 ${d.plannedDone.length}개` : '계획한 일이 없어요'} bar={d.rate ?? 0} />
          <Stat label="끝낸 일" value={`${d.plannedDone.length + d.unplannedDone.length}개`} sub={d.unplannedDone.length ? `계획 밖 ${d.unplannedDone.length}개 포함` : '계획한 일 기준'} />
          <Stat label="집중 시간" value={fmtMinutes(d.doneMinutes)} sub={`계획 ${fmtMinutes(d.plannedMinutes)} (시간 블록)`} bar={d.plannedMinutes ? Math.min(1, d.doneMinutes / d.plannedMinutes) : 0} />
          <Stat label="일정" value={`${d.events.length}개`} sub={fmtMinutes(d.eventMinutes)} />
        </div>

        {!d.hasPlan && d.planned.length > 0 && (
          <p className="-mt-3 text-[12px] text-fg3">이날은 아침 계획을 확정하지 않아서, 그날로 잡혀 있던 할 일을 계획으로 보고 계산했어요.</p>
        )}

        <section>
          <h3 className="mb-1 px-1 text-[14px] font-semibold">계획 대비 결과</h3>
          {d.planned.length === 0 && <p className="px-1 text-[13px] text-fg3">계획한 일이 없어요.</p>}
          <ul>
            {d.planned.map((t) => (
              <PlanRow key={t.id} t={t} meta={blockMinutes(t) ? fmtMinutes(blockMinutes(t)) : undefined}>
                {!t.done && !t.occ && <Act onClick={() => moveToDate(t, tomorrow)}>내일로</Act>}
              </PlanRow>
            ))}
          </ul>
          {left.length > 1 && (
            <button onClick={() => left.forEach((t) => void moveToDate(t, tomorrow))} className="mt-1 px-2 text-[12px] font-medium text-accent hover:underline">
              못 끝낸 {left.length}개 모두 내일로
            </button>
          )}
        </section>

        {d.unplannedDone.length > 0 && (
          <section>
            <h3 className="mb-1 px-1 text-[14px] font-semibold">계획에 없었지만 끝낸 일</h3>
            <ul>
              {d.unplannedDone.map((t) => (
                <PlanRow key={t.id} t={t} />
              ))}
            </ul>
          </section>
        )}

        <Reflection key={date} date={date} journal={journal} tomorrow={tomorrow} />
      </div>
    </div>
  )
}

function Stat({ label, value, sub, bar }: { label: string; value: string; sub: string; bar?: number }) {
  return (
    <div className="rounded-[10px] border border-line p-3">
      <div className="text-[12px] text-fg2">{label}</div>
      <div className="tnum mt-0.5 text-[22px] font-bold">{value}</div>
      <div className="truncate text-[12px] text-fg3">{sub}</div>
      {bar !== undefined && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-active">
          <div className="h-full rounded-full bg-[var(--c-green-bar)]" style={{ width: `${Math.round(bar * 100)}%` }} />
        </div>
      )}
    </div>
  )
}

/** 회고 입력 (날짜별 자동 저장) */
function Reflection({ date, journal, tomorrow }: { date: string; journal?: Journal; tomorrow: string }) {
  // null = 아직 안 고침 → 저장된 값을 보여 준다 (날짜가 바뀌면 key 로 새로 만들어짐)
  const [note, setNote] = useState<string | null>(null)
  const [good, setGood] = useState<string | null>(null)
  const [better, setBetter] = useState<string | null>(null)

  const field = (v: string | null, set: (s: string) => void, key: 'note' | 'good' | 'better', ph: string, rows = 2) => (
    <textarea
      value={v ?? journal?.[key] ?? ''}
      rows={rows}
      onChange={(e) => {
        set(e.target.value)
        void saveJournal(date, { [key]: e.target.value || undefined })
      }}
      placeholder={ph}
      className="w-full resize-y rounded-[8px] border border-line bg-transparent px-3 py-2 text-[14px] outline-none focus:border-accent"
    />
  )

  return (
    <section className="flex flex-col gap-3 rounded-[12px] bg-sidebar p-4">
      <h3 className="text-[14px] font-semibold">오늘 회고</h3>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[13px] text-fg2">오늘 기분</span>
        {MOODS.map((m, i) => (
          <button
            key={m}
            onClick={() => saveJournal(date, { mood: journal?.mood === i + 1 ? undefined : i + 1 })}
            title={MOOD_LABEL[i]}
            aria-label={MOOD_LABEL[i]}
            aria-pressed={journal?.mood === i + 1}
            className={`grid h-9 w-9 place-items-center rounded-full text-[20px] transition ${journal?.mood === i + 1 ? 'scale-110 bg-bg shadow-pop' : 'opacity-50 grayscale hover:opacity-100 hover:grayscale-0'}`}
          >
            {m}
          </button>
        ))}
        {journal?.mood && <span className="text-[12px] text-fg2">{MOOD_LABEL[journal.mood - 1]}</span>}
      </div>
      {field(note, setNote, 'note', '한 줄 회고: 오늘은 어땠나요?', 2)}
      <div className="grid gap-3 md:grid-cols-2">
        {field(good, setGood, 'good', '👍 잘한 점')}
        {field(better, setBetter, 'better', '🔧 아쉬운 점 / 내일 바꿀 점')}
      </div>
      <div className="rounded-[8px] border border-dashed border-line-strong">
        <QuickTask due={tomorrow} priority="high" placeholder="⭐ 내일 가장 중요한 일 하나 (Enter → 내일 할 일로 추가, 우선순위 높음)" />
      </div>
      <p className="text-[12px] text-fg3">입력하면 바로 저장돼요{journal?.updatedAt ? ` · ${format(new Date(journal.updatedAt), 'HH:mm')} 저장` : ''}. GitHub 동기화를 켜 두면 다른 기기에서도 보여요.</p>
    </section>
  )
}

/* ═════════ 주간 리뷰 ═════════ */
function WeekView() {
  const items = useItems()
  const { dayDate, setDayDate, setDaySub } = useUI()
  const monday = startOfWeek(dayDate, WEEK)
  const days = Array.from({ length: 7 }, (_, i) => ymd(addDays(monday, i)))
  const journals = useJournals(days[0], days[6])
  const weekKey = `week:${days[0]}`
  const weekJ = useJournal(weekKey)
  const today = ymd(new Date())

  const rows = useMemo(() => days.map((d) => dayData(items, d, journals.find((j) => j.date === d))), [items, journals, days.join()])
  const past = rows.filter((r) => r.date <= today)
  const rated = past.filter((r) => r.rate !== null)
  const doneAll = rows.flatMap((r) => [...r.plannedDone, ...r.unplannedDone]).filter((t, i, a) => a.findIndex((x) => x.id === t.id) === i)
  const tagCount = new Map<string, number>()
  for (const t of doneAll) for (const tag of t.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1)
  const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  const moods = journals.filter((j) => j.mood).map((j) => j.mood!)
  const avgMood = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-24 md:px-6">
      <div className="mx-auto flex max-w-[920px] flex-col gap-6">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          <Stat label="끝낸 일" value={`${doneAll.length}개`} sub={`${format(monday, 'M월 d일')} 주`} />
          <Stat
            label="평균 완료율"
            value={rated.length ? `${Math.round((rated.reduce((s, r) => s + r.rate!, 0) / rated.length) * 100)}%` : '—'}
            sub={`${rated.length}일 기준`}
            bar={rated.length ? rated.reduce((s, r) => s + r.rate!, 0) / rated.length : 0}
          />
          <Stat label="집중 시간" value={fmtMinutes(rows.reduce((s, r) => s + r.doneMinutes, 0))} sub="끝낸 시간 블록 합" />
          <Stat label="기분" value={avgMood ? MOODS[Math.round(avgMood) - 1] : '—'} sub={avgMood ? `평균 ${avgMood.toFixed(1)} / 5 · ${moods.length}일 기록` : '기록이 없어요'} />
        </div>

        <section>
          <h3 className="mb-2 px-1 text-[14px] font-semibold">요일별</h3>
          <div className="overflow-hidden rounded-[10px] border border-line">
            {rows.map((r) => {
              const j = journals.find((x) => x.date === r.date)
              const future = r.date > today
              return (
                <button
                  key={r.date}
                  onClick={() => {
                    setDayDate(parseYmd(r.date))
                    setDaySub('review')
                  }}
                  className={`flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-hover ${r.date === today ? 'bg-accent-soft' : ''}`}
                >
                  <span className="tnum w-[74px] shrink-0 text-[13px]">
                    <b>{format(parseYmd(r.date), 'EEE', { locale: ko })}</b> <span className="text-fg2">{format(parseYmd(r.date), 'M/d')}</span>
                  </span>
                  <span className="w-7 shrink-0 text-center text-[18px]">{j?.mood ? MOODS[j.mood - 1] : <span className="text-[13px] text-fg3">·</span>}</span>
                  <span className="flex w-[130px] shrink-0 items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-active">
                      <span className="block h-full rounded-full bg-[var(--c-green-bar)]" style={{ width: `${future ? 0 : Math.round((r.rate ?? 0) * 100)}%` }} />
                    </span>
                    <span className="tnum w-9 text-right text-[12px] text-fg2">{r.rate === null || future ? '—' : `${Math.round(r.rate * 100)}%`}</span>
                  </span>
                  <span className="tnum hidden w-[110px] shrink-0 text-[12px] text-fg2 sm:inline">
                    {future ? `예정 ${r.planned.length}개` : `${r.plannedDone.length + r.unplannedDone.length}개 끝냄`}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px] text-fg2">{j?.note ?? ''}</span>
                </button>
              )
            })}
          </div>
          {topTags.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 text-[12px] text-fg2">
              이번 주 많이 한 일:
              {topTags.map(([t, n]) => (
                <span key={t} className="rounded-[4px] px-1.5 py-px" style={colorVars(tagColor(t))}>
                  {t} {n}
                </span>
              ))}
            </div>
          )}
        </section>

        <WeekNotes key={weekKey} weekKey={weekKey} journal={weekJ} />
      </div>
    </div>
  )
}

function WeekNotes({ weekKey, journal }: { weekKey: string; journal?: Journal }) {
  const [good, setGood] = useState<string | null>(null)
  const [better, setBetter] = useState<string | null>(null)
  const g = good ?? journal?.good ?? ''
  const b = better ?? journal?.better ?? ''
  return (
    <section className="flex flex-col gap-3 rounded-[12px] bg-sidebar p-4">
      <h3 className="text-[14px] font-semibold">이번 주 회고</h3>
      <div className="grid gap-3 md:grid-cols-2">
        <textarea
          value={g}
          rows={4}
          onChange={(e) => {
            setGood(e.target.value)
            void saveJournal(weekKey, { good: e.target.value || undefined })
          }}
          placeholder="👍 이번 주 잘한 점, 이룬 것"
          className="w-full resize-y rounded-[8px] border border-line bg-transparent px-3 py-2 text-[14px] outline-none focus:border-accent"
        />
        <textarea
          value={b}
          rows={4}
          onChange={(e) => {
            setBetter(e.target.value)
            void saveJournal(weekKey, { better: e.target.value || undefined })
          }}
          placeholder="🔧 다음 주에 바꿀 점"
          className="w-full resize-y rounded-[8px] border border-line bg-transparent px-3 py-2 text-[14px] outline-none focus:border-accent"
        />
      </div>
    </section>
  )
}
