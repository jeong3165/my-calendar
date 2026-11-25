import { useMemo, useState } from 'react'
import { addDays, endOfMonth, format, startOfMonth } from 'date-fns'
import { ko } from 'date-fns/locale'
import { db, useItems, useJournals, useSessions } from '../db'
import { useUI } from '../store'
import type { Item } from '../types'
import { parseYmd, ymd } from '../lib/date'
import { colorVars, isTimed, tagColor, taskKey } from '../lib/items'
import { isRecurring, parseOccId } from '../lib/recur'
import { fmtMinutes } from '../lib/review'
import { ddayInfo } from '../lib/dday'
import { cleanTag, useAllTags } from './TagInput'
import { NoteLinks } from './NoteLinks'
import { Checkbox, Icon, toggleDone } from './ui'

type Period = 'all' | 'month' | 'last30' | 'upcoming'
const PERIODS: [Period, string][] = [
  ['all', '전체'],
  ['month', '이번 달'],
  ['last30', '지난 30일'],
  ['upcoming', '앞으로'],
]

/** 태그 보기: 태그 하나로 일정·할 일·프로젝트·기념일·하루 기록·집중 시간을 한곳에 */
export function TagView() {
  const tag = useUI((s) => s.tagView)
  const { open, showToast, isMobile } = useUI()
  const set = (t: string | null) => useUI.setState({ tagView: t })
  const all = useAllTags()
  const items = useItems()
  const journals = useJournals('0000-01-01', '9999-12-31')
  const sessions = useSessions('0000-01-01', '9999-12-31')
  const [period, setPeriod] = useState<Period>('all')
  const [q, setQ] = useState('')

  const today = ymd(new Date())
  const range: [string, string] =
    period === 'month' ? [ymd(startOfMonth(new Date())), ymd(endOfMonth(new Date()))] : period === 'last30' ? [ymd(addDays(new Date(), -30)), today] : period === 'upcoming' ? [today, '9999-12-31'] : ['0000-01-01', '9999-12-31']
  const inRange = (d?: string) => !d || (d >= range[0] && d <= range[1])

  const data = useMemo(() => {
    if (!tag) return null
    const has = (it: Item) => it.tags.includes(tag) && !it.readonly
    const dateOf = (it: Item) => (it.start ? ymd(new Date(it.start)) : taskKey(it))
    const tagged = items.filter(has)
    const projects = tagged.filter((x) => x.type === 'project')
    const ddays = tagged.filter((x) => x.type === 'dday')
    const events = tagged.filter((x) => x.type === 'event' && inRange(dateOf(x))).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
    const tasks = tagged.filter((x) => x.type === 'task' && (period === 'all' || (dateOf(x) ? inRange(dateOf(x)) : period !== 'upcoming' ? false : true)))
    const open_ = tasks.filter((t) => !t.done).sort((a, b) => (taskKey(a) ?? '9999').localeCompare(taskKey(b) ?? '9999'))
    const done = tasks.filter((t) => t.done).sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
    const days = journals.filter((j) => j.date.length === 10 && j.tags?.includes(tag) && inRange(j.date)).sort((a, b) => b.date.localeCompare(a.date))
    const ids = new Set(tagged.map((x) => x.id))
    const focus = sessions.filter((s) => s.itemId && ids.has(parseOccId(s.itemId)?.seriesId ?? s.itemId) && inRange(s.date)).reduce((a, s) => a + s.minutes, 0)
    const minutes = [...events, ...tasks].filter(isTimed).reduce((a, x) => a + (new Date(x.end!).getTime() - new Date(x.start!).getTime()) / 60000, 0)
    return { projects, ddays, events, open: open_, done, days, focus, minutes }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag, items, journals, sessions, period])

  async function rename() {
    if (!tag) return
    const to = cleanTag(prompt(`"${tag}" 태그의 새 이름`, tag) ?? '')
    if (!to || to === tag) return
    const now = new Date().toISOString()
    await db.transaction('rw', db.items, db.journal, async () => {
      for (const it of await db.items.toArray()) if (it.tags.includes(tag)) await db.items.put({ ...it, tags: [...new Set(it.tags.map((t) => (t === tag ? to : t)))], updatedAt: now })
      for (const j of await db.journal.toArray()) if (j.tags?.includes(tag)) await db.journal.put({ ...j, tags: [...new Set(j.tags.map((t) => (t === tag ? to : t)))], updatedAt: now })
    })
    set(to)
    showToast(`태그 이름을 "${to}"(으)로 바꿨어요. 같은 이름이 있으면 합쳐져요.`)
  }
  async function remove() {
    if (!tag || !confirm(`모든 항목에서 "${tag}" 태그를 뺄까요? (항목은 지워지지 않아요)`)) return
    const now = new Date().toISOString()
    await db.transaction('rw', db.items, db.journal, async () => {
      for (const it of await db.items.toArray()) if (it.tags.includes(tag)) await db.items.put({ ...it, tags: it.tags.filter((t) => t !== tag), updatedAt: now })
      for (const j of await db.journal.toArray()) if (j.tags?.includes(tag)) await db.journal.put({ ...j, tags: j.tags.filter((t) => t !== tag), updatedAt: now })
    })
    set(null)
    showToast(`"${tag}" 태그를 뺐어요.`)
  }

  const list = all.filter((t) => !q.trim() || t.tag.toLowerCase().includes(q.trim().toLowerCase()))
  const tagList = (
    <div className={isMobile ? 'flex gap-1.5 overflow-x-auto px-3 py-2' : 'flex flex-col gap-0.5 px-2 py-2'}>
      {!isMobile && (
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="태그 찾기" className="mb-1 rounded-[6px] border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-accent" />
      )}
      {list.length === 0 && <p className="px-2 py-3 text-[13px] text-fg3">태그가 없어요. 항목·프로젝트·기념일·하루 정리에서 #태그를 붙여 보세요.</p>}
      {list.map(({ tag: t, count }) => (
        <button
          key={t}
          onClick={() => set(t)}
          className={`flex shrink-0 items-center gap-2 rounded-[6px] px-2 py-1 text-left text-[13.5px] ${t === tag ? 'bg-active font-medium' : 'hover:bg-hover'}`}
        >
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(--c-${tagColor(t)}-bar)` }} />
          <span className="min-w-0 flex-1 truncate whitespace-nowrap">{t}</span>
          <span className="tnum text-[12px] text-fg3">{count}</span>
        </button>
      ))}
    </div>
  )

  return (
    <div className={`flex min-h-0 flex-1 ${isMobile ? 'flex-col' : ''}`}>
      <aside className={isMobile ? 'shrink-0 border-b border-line' : 'w-56 shrink-0 overflow-y-auto border-r border-line'}>{tagList}</aside>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!tag || !data ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center text-fg2">
            <Icon name="hash" size={28} className="text-fg3" />
            <p className="text-[15px] font-medium text-fg">태그를 고르세요</p>
            <p className="text-[13px]">일정·할 일·프로젝트·기념일·하루 기록에 붙인 태그별로 모아 보고, 쓴 시간과 집중 시간도 볼 수 있어요.</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-[820px] flex-col gap-5 px-6 py-5 max-md:px-3 max-md:py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-[5px] px-2 py-0.5 text-[18px] font-semibold" style={colorVars(tagColor(tag))}>
                #{tag}
              </span>
              <span className="flex-1" />
              <button onClick={rename} className="rounded-[6px] px-2 py-1 text-[13px] text-fg2 hover:bg-hover">
                이름 바꾸기
              </button>
              <button onClick={remove} className="rounded-[6px] px-2 py-1 text-[13px] text-fg2 hover:bg-hover hover:text-danger">
                태그 빼기
              </button>
              <button
                onClick={() => useUI.setState({ exportOpen: true, exportPreset: { tag, ...(period === 'all' ? {} : { from: range[0], to: range[1] === '9999-12-31' ? ymd(addDays(new Date(), 365)) : range[1] }) } })}
                className="flex items-center gap-1 rounded-[6px] border border-line-strong px-2.5 py-1 text-[13px] hover:bg-hover"
              >
                <Icon name="download" size={13} /> 엑셀로
              </button>
            </div>

            <div className="flex rounded-[6px] bg-hover p-0.5 text-[13px] md:self-start" role="tablist" aria-label="기간">
              {PERIODS.map(([k, l]) => (
                <button key={k} role="tab" aria-selected={period === k} onClick={() => setPeriod(k)} className={`h-7 flex-1 rounded-[5px] px-3 whitespace-nowrap ${period === k ? 'bg-bg font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2'}`}>
                  {l}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-4 gap-2.5 max-md:grid-cols-2">
              <Tile label="일정" value={`${data.events.length}개`} sub={data.minutes ? `시간 블록 ${fmtMinutes(Math.round(data.minutes))}` : undefined} />
              <Tile label="할 일" value={`${data.open.length + data.done.length}개`} sub={`완료 ${data.done.length} · 남음 ${data.open.length}`} />
              <Tile label="집중 시간" value={data.focus ? fmtMinutes(data.focus) : '—'} sub="타이머 기록" />
              <Tile label="하루 기록" value={`${data.days.length}일`} sub={data.projects.length || data.ddays.length ? `프로젝트 ${data.projects.length} · 기념일 ${data.ddays.length}` : undefined} />
            </div>

            {data.projects.length > 0 && (
              <Section title="프로젝트">
                {data.projects.map((p) => (
                  <Row key={p.id} onClick={() => useUI.getState().openProject(p.id)} left={<span>{p.icon ?? '📁'}</span>} title={p.title || '이름 없음'} meta={p.done ? '완료' : p.due ? `마감 ${p.due.slice(5).replace('-', '/')}` : ''} />
                ))}
              </Section>
            )}
            <NoteLinks filter={(n) => n.tags.includes(tag)} title="메모" />
            {data.open.length > 0 && (
              <Section title={`할 일 ${data.open.length}`}>
                {data.open.map((t) => (
                  <Row key={t.id} onClick={() => open(t.id)} left={<Checkbox checked={false} onChange={() => void toggleDone(t)} size={15} />} title={t.title} meta={(isRecurring(t) ? '반복 · ' : '') + (taskKey(t)?.slice(5).replace('-', '/') ?? '날짜 없음')} danger={(taskKey(t) ?? '9999') < today} />
                ))}
              </Section>
            )}
            {data.events.length > 0 && (
              <Section title={`일정 ${data.events.length}`}>
                {data.events.slice(-60).map((e) => (
                  <Row
                    key={e.id}
                    onClick={() => open(e.id)}
                    left={<span className="h-2 w-2 rounded-full" style={{ background: `var(--c-${e.color}-bar)` }} />}
                    title={e.title}
                    meta={e.start ? format(new Date(e.start), isTimed(e) ? 'M/d (EEE) HH:mm' : 'M/d (EEE)', { locale: ko }) + (isRecurring(e) ? ' · 반복' : '') : ''}
                  />
                ))}
              </Section>
            )}
            {data.ddays.length > 0 && (
              <Section title="기념일·D-day">
                {data.ddays.map((d) => {
                  const info = ddayInfo(d)
                  return <Row key={d.id} onClick={() => useUI.setState({ ddayEdit: d.id })} left={<span>{d.icon ?? '🎉'}</span>} title={d.title} meta={info?.label ?? ''} />
                })}
              </Section>
            )}
            {data.days.length > 0 && (
              <Section title="하루 기록">
                {data.days.map((j) => (
                  <Row
                    key={j.date}
                    onClick={() => {
                      const ui = useUI.getState()
                      ui.setMode('day')
                      ui.setDaySub('review')
                      ui.setDayDate(parseYmd(j.date))
                    }}
                    left={<Icon name="sun" size={14} className="text-fg3" />}
                    title={format(parseYmd(j.date), 'M월 d일 (EEE)', { locale: ko })}
                    meta={j.note ?? ''}
                  />
                ))}
              </Section>
            )}
            {data.done.length > 0 && (
              <Section title={`완료한 할 일 ${data.done.length}`}>
                {data.done.slice(0, 50).map((t) => (
                  <Row key={t.id} onClick={() => open(t.id)} left={<Checkbox checked onChange={() => void toggleDone(t)} size={15} />} title={t.title} meta={t.doneAt ? format(new Date(t.doneAt), 'M/d') + ' 완료' : ''} muted />
                ))}
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] border border-line px-3.5 py-2.5">
      <span className="text-[12px] text-fg2">{label}</span>
      <span className="tnum text-[20px] leading-tight font-semibold">{value}</span>
      {sub && <span className="truncate text-[11.5px] text-fg3">{sub}</span>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 px-1 text-[13px] font-semibold text-fg2">{title}</h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  )
}

function Row({ left, title, meta, onClick, danger, muted }: { left: React.ReactNode; title: string; meta?: string; onClick: () => void; danger?: boolean; muted?: boolean }) {
  return (
    <li className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 hover:bg-hover">
      <span className="grid w-5 shrink-0 place-items-center">{left}</span>
      <button onClick={onClick} className={`min-w-0 flex-1 truncate text-left text-[14px] ${muted ? 'text-fg3 line-through' : ''}`}>
        {title || '(제목 없음)'}
      </button>
      {meta && <span className={`tnum shrink-0 truncate text-[12px] ${danger ? 'text-danger' : 'text-fg3'} max-w-[45%]`}>{meta}</span>}
    </li>
  )
}
