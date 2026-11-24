import { differenceInCalendarDays, format } from 'date-fns'
import type { Item, NotionColor, Priority, Status } from '../types'
import { relDay, ymd } from '../lib/date'
import { isTimed } from '../lib/items'

export const STATUS_COLOR: Record<Status, NotionColor> = { todo: 'gray', doing: 'blue', done: 'green' }
export const PRIORITY_COLOR: Record<Priority, NotionColor> = { high: 'red', normal: 'gray', low: 'brown' }

/** "오늘 15:00–16:00", "내일", "11월 30일 ~ 12월 2일" */
export function fmtWhen(it: Item): string {
  if (it.start && it.allDay) {
    const s = ymd(new Date(it.start))
    const e = it.end ? ymd(new Date(it.end)) : s
    return e > s ? `${relDay(s)} ~ ${relDay(e)}` : relDay(s)
  }
  if (isTimed(it)) {
    const s = new Date(it.start!)
    const e = new Date(it.end!)
    const multi = differenceInCalendarDays(e, s) > 0
    return `${relDay(ymd(s))} ${format(s, 'HH:mm')}–${multi ? `${relDay(ymd(e))} ` : ''}${format(e, 'HH:mm')}`
  }
  return it.due ? relDay(it.due) : ''
}

export function isOverdue(it: Item, now = new Date()): boolean {
  if (it.type !== 'task' || it.done) return false
  if (isTimed(it)) return new Date(it.end!) < now
  return !!it.due && it.due < ymd(now)
}
