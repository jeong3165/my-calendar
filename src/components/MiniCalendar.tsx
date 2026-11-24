import { useEffect, useMemo, useState } from 'react'
import { addDays, addMonths, format, isSameDay, isSameMonth, isToday, startOfMonth, startOfWeek } from 'date-fns'
import { useItems } from '../db'
import { useUI } from '../store'
import { WEEK, WEEKDAYS, ymd } from '../lib/date'
import { taskKey } from '../lib/items'
import { Icon } from './ui'

export function MiniCalendar() {
  const { date, setDate, view } = useUI()
  const items = useItems()
  const [month, setMonth] = useState(() => startOfMonth(date))
  useEffect(() => setMonth(startOfMonth(date)), [date])

  const first = startOfWeek(month, WEEK)
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i))
  const busy = useMemo(() => {
    const s = new Set<string>()
    for (const it of items) {
      if (it.type === 'task' && it.done) continue
      const k = it.type === 'task' ? taskKey(it) : it.start ? ymd(new Date(it.start)) : undefined
      if (k) s.add(k)
    }
    return s
  }, [items])

  const inRange = (d: Date) => {
    if (view === 'day') return isSameDay(d, date)
    if (view === 'week') return ymd(startOfWeek(d, WEEK)) === ymd(startOfWeek(date, WEEK))
    return false
  }

  return (
    <div className="px-3 pb-2">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-[13px] font-semibold">{format(month, 'yyyy년 M월')}</span>
        <div className="flex">
          <button onClick={() => setMonth(addMonths(month, -1))} className="grid h-6 w-6 place-items-center rounded text-fg2 hover:bg-hover" aria-label="이전 달">
            <Icon name="left" size={14} />
          </button>
          <button onClick={() => setMonth(addMonths(month, 1))} className="grid h-6 w-6 place-items-center rounded text-fg2 hover:bg-hover" aria-label="다음 달">
            <Icon name="right" size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-0.5 text-[11px] text-fg3">
            {w}
          </div>
        ))}
        {days.map((d) => {
          const today = isToday(d)
          const sel = inRange(d)
          return (
            <button
              key={d.toISOString()}
              onClick={() => setDate(d)}
              className={`tnum relative mx-auto my-px grid h-7 w-7 place-items-center rounded-full text-[12px] ${
                today ? 'bg-accent font-semibold text-white' : sel ? 'bg-active font-medium' : 'hover:bg-hover'
              } ${!today && !isSameMonth(d, month) ? 'text-fg3' : ''}`}
            >
              {d.getDate()}
              {busy.has(ymd(d)) && !today && <span className="absolute bottom-0.5 h-[3px] w-[3px] rounded-full bg-fg3" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}
