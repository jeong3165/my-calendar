import { useState, type DragEvent } from 'react'
import { addDays, differenceInCalendarDays, format, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { useMemo } from 'react'
import { createItem } from '../db'
import { useCalendarItems } from '../lib/subs'
import { expandItems, resolveItem, updateSmart } from '../lib/recur'
import { useUI } from '../store'
import { TONE_TEXT, dayTone, useHoliday, weekdayTone } from '../lib/holidays'
import { WEEK, WEEKDAYS, ymd } from '../lib/date'
import { dayItems, isTimed } from '../lib/items'
import { ItemChip } from './ui'

const MAX = 3

export function MonthView() {
  const all = useCalendarItems()
  const holiday = useHoliday()
  const { date, open, selectedId, setDate, setView, isMobile } = useUI()
  const short = (n: string) => (isMobile ? n.replace('대체공휴일', '대체휴일').replace('전국동시지방선거', '지방선거').replace(/^임시공휴일.*/, '임시휴일') : n)
  const [over, setOver] = useState<string | null>(null)
  const first = startOfWeek(startOfMonth(date), WEEK)
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i))
  const firstKey = ymd(first)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => expandItems(all, first, addDays(first, 42)), [all, firstKey])

  async function onDrop(e: DragEvent, day: Date) {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('application/x-item')
    const it = resolveItem(all, id)
    if (!it) return
    if (it.start) {
      // 시간/종일 일정 → 날짜만 옮기고 시각과 길이는 유지
      const diff = differenceInCalendarDays(day, new Date(it.start))
      const shift = (iso?: string) => (iso ? addDays(new Date(iso), diff).toISOString() : undefined)
      await updateSmart(it, { start: shift(it.start), end: shift(it.end), ...(it.type === 'task' && it.due ? { due: ymd(day) } : {}) })
    } else if (it.type === 'task') {
      await updateSmart(it, { due: ymd(day) })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`py-1.5 text-center text-[12px] ${weekdayTone(i) ? TONE_TEXT[weekdayTone(i)!] : 'text-fg2'}`}>
            {w}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d) => {
          const key = ymd(d)
          const { allDay, timed } = dayItems(items, d)
          const all = [...allDay, ...timed]
          const shown = all.slice(0, all.length > MAX ? MAX - 1 : MAX)
          const rest = all.length - shown.length
          const inMonth = isSameMonth(d, date)
          const today = isToday(d)
          const hol = holiday(d)
          const tone = dayTone(d, hol)
          return (
            <div
              key={key}
              className={`flex min-h-0 flex-col gap-px overflow-hidden border-r border-b border-line p-1 ${over === key ? 'bg-accent-soft' : hol?.off ? 'bg-[color-mix(in_srgb,var(--danger)_7%,transparent)]' : inMonth ? '' : 'bg-sidebar/60'}`}
              onDoubleClick={async () => {
                const it = await createItem({ type: 'event', allDay: true, start: startOfDay(d).toISOString(), end: startOfDay(d).toISOString() })
                open(it.id, true)
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('application/x-item')) return
                e.preventDefault()
                if (over !== key) setOver(key)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
              }}
              onDrop={(e) => onDrop(e, d)}
            >
              <div className="flex items-center justify-end gap-1 max-md:flex-col-reverse max-md:items-stretch max-md:gap-0">
                {hol && (
                  <span className={`min-w-0 flex-1 truncate pl-0.5 text-[11px] max-md:pl-0 max-md:text-center max-md:text-[9.5px] max-md:leading-tight ${hol.off ? 'font-medium text-danger' : 'text-fg3'}`} title={hol.names.join(', ')}>
                    {hol.names.map(short).join(' · ')}
                  </span>
                )}
                <button
                  onClick={() => {
                    setDate(d)
                    setView('day')
                  }}
                  className={`tnum grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] max-md:self-end ${
                    today ? 'bg-accent font-semibold text-white' : tone ? `${TONE_TEXT[tone]} hover:bg-hover ${inMonth ? '' : 'opacity-50'}` : inMonth ? 'text-fg hover:bg-hover' : 'text-fg3 hover:bg-hover'
                  }`}
                >
                  {d.getDate() === 1 ? (
                    <span className="whitespace-nowrap">
                      <span className="max-md:hidden">{format(d, 'M월 ')}</span>1<span className="max-md:hidden">일</span>
                    </span>
                  ) : (
                    d.getDate()
                  )}
                </button>
              </div>
              {shown.map((it) => (
                <ItemChip key={it.id} item={it} selected={it.id === selectedId} onOpen={() => open(it.id)} showTime={isTimed(it)} />
              ))}
              {rest > 0 && (
                <button
                  onClick={() => {
                    setDate(d)
                    setView('day')
                  }}
                  className="rounded-[4px] px-1.5 text-left text-[12px] text-fg2 hover:bg-hover"
                >
                  +{rest}개 더
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
