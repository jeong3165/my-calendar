import { useState, type DragEvent } from 'react'
import { addDays, differenceInCalendarDays, format, isSameMonth, isToday, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { createItem, updateItem, useItems } from '../db'
import { useUI } from '../store'
import { WEEK, WEEKDAYS, ymd } from '../lib/date'
import { dayItems, isTimed } from '../lib/items'
import { ItemChip } from './ui'

const MAX = 3

export function MonthView() {
  const items = useItems()
  const { date, open, selectedId, setDate, setView } = useUI()
  const [over, setOver] = useState<string | null>(null)
  const first = startOfWeek(startOfMonth(date), WEEK)
  const days = Array.from({ length: 42 }, (_, i) => addDays(first, i))

  async function onDrop(e: DragEvent, day: Date) {
    e.preventDefault()
    setOver(null)
    const id = e.dataTransfer.getData('application/x-item')
    const it = items.find((x) => x.id === id)
    if (!it) return
    if (it.start) {
      // 시간/종일 일정 → 날짜만 옮기고 시각과 길이는 유지
      const diff = differenceInCalendarDays(day, new Date(it.start))
      const shift = (iso?: string) => (iso ? addDays(new Date(iso), diff).toISOString() : undefined)
      await updateItem(id, { start: shift(it.start), end: shift(it.end), ...(it.type === 'task' && it.due ? { due: ymd(day) } : {}) })
    } else if (it.type === 'task') {
      await updateItem(id, { due: ymd(day) })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b border-line">
        {WEEKDAYS.map((w, i) => (
          <div key={w} className={`py-1.5 text-center text-[12px] ${i >= 5 ? 'text-fg3' : 'text-fg2'}`}>
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
          return (
            <div
              key={key}
              className={`flex min-h-0 flex-col gap-px overflow-hidden border-r border-b border-line p-1 ${over === key ? 'bg-accent-soft' : inMonth ? '' : 'bg-sidebar/60'}`}
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
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setDate(d)
                    setView('day')
                  }}
                  className={`tnum grid h-6 min-w-6 place-items-center rounded-full px-1 text-[12px] ${
                    today ? 'bg-accent font-semibold text-white' : inMonth ? 'text-fg hover:bg-hover' : 'text-fg3 hover:bg-hover'
                  }`}
                >
                  {d.getDate() === 1 ? format(d, 'M월 d일') : d.getDate()}
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
