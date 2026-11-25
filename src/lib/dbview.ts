import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from 'date-fns'
import { updateItem } from '../db'
import type { Item, Status } from '../types'
import { WEEK, ymd } from './date'
import { isTimed } from './items'
import { baseDate, instance, isRecurring, nextOccurrence, occurrences, toggleOccurrenceDone } from './recur'

import { DEFAULT_FILTERS, type Filters } from './filters'
export * from './filters'

export const statusOf = (it: Item): Status => (it.done ? 'done' : it.doing ? 'doing' : 'todo')

/** 항목의 대표 날짜 (YYYY-MM-DD) */
export const dateKey = (it: Item): string | undefined => (it.start ? ymd(new Date(it.start)) : it.due)
/** 정렬용 시각 */
export const sortTime = (it: Item): string => it.start ?? (it.due ? `${it.due}T23:59` : '')

/** 반복 항목은 '오늘 또는 다음 회차' 하나로 보여 준다 (끝난 반복은 마지막 회차) */
export function toRows(items: Item[], now = new Date()): Item[] {
  const today = ymd(now)
  return items.filter((it) => it.type !== 'project' && it.type !== 'template' && it.type !== 'dday').map((it) => {
    if (!isRecurring(it)) return it
    const next = nextOccurrence(it, today)
    if (next) return instance(it, next)
    const past = occurrences(it, baseDate(it)!, today)
    return instance(it, past.at(-1) ?? baseDate(it)!)
  })
}

export function applyFilters(rows: Item[], f: Filters, now = new Date()): Item[] {
  const today = ymd(now)
  const q = f.q.trim().toLowerCase()
  const range: [string, string] | null =
    f.period === 'today'
      ? [today, today]
      : f.period === 'week'
        ? [ymd(startOfWeek(now, WEEK)), ymd(endOfWeek(now, WEEK))]
        : f.period === 'month'
          ? [ymd(startOfMonth(now)), ymd(endOfMonth(now))]
          : null
  return rows.filter((it) => {
    if (f.type !== 'all' && it.type !== f.type) return false
    if (f.hideDone && it.done) return false
    if (q && !`${it.title}\n${it.note ?? ''}\n${it.tags.join(' ')}`.toLowerCase().includes(q)) return false
    if (f.tags.length && !f.tags.some((t) => it.tags.includes(t))) return false
    if (f.projects?.length && !f.projects.includes(it.projectId ?? 'none')) return false
    if (f.priorities.length && (it.type !== 'task' || !f.priorities.includes(it.priority ?? 'normal'))) return false
    const k = dateKey(it)
    if (f.period === 'none') return !k
    if (f.period === 'overdue') return !!k && (isTimed(it) ? new Date(it.end!) < now : k < today) && !it.done
    if (range) {
      if (!k) return false
      const last = it.end && !isTimed(it) && it.allDay ? ymd(new Date(it.end)) : k
      return last >= range[0] && k <= range[1]
    }
    return true
  })
}

export const isFiltered = (f: Filters) => JSON.stringify({ ...f, type: 'all' }) !== JSON.stringify({ ...DEFAULT_FILTERS, type: 'all' })

/* ───────── 정렬 ───────── */
import type { Sort } from './filters'
const prioRank = { high: 0, normal: 1, low: 2 }
const statusRank = { todo: 0, doing: 1, done: 2 }

export function sortRows(rows: Item[], s: Sort): Item[] {
  const val = (it: Item): string | number => {
    switch (s.key) {
      case 'title':
        return it.title.toLowerCase()
      case 'type':
        return it.type
      case 'date':
        return sortTime(it) || '￿' // 날짜 없음은 맨 뒤
      case 'status':
        return it.type === 'task' ? statusRank[statusOf(it)] : 9
      case 'priority':
        return it.type === 'task' ? prioRank[it.priority ?? 'normal'] : 9
      case 'project':
        return it.projectId ?? '\uffff'
      case 'tags':
        return it.tags.join(',') || '￿'
      case 'updated':
        return it.updatedAt
    }
  }
  const dir = s.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = val(a)
    const y = val(b)
    if (x < y) return -dir
    if (x > y) return dir
    return sortTime(a).localeCompare(sortTime(b)) || a.createdAt.localeCompare(b.createdAt)
  })
}

/* ───────── 상태 바꾸기 ───────── */
export async function setStatus(it: Item, status: Status): Promise<string | null> {
  if (it.type !== 'task') return '일정에는 상태가 없어요.'
  if (statusOf(it) === status) return null
  if (it.occ) {
    // 반복 할 일은 회차별로 '완료'만 기록한다
    if (status === 'doing') return '반복 할 일은 "할 일"과 "완료"만 쓸 수 있어요.'
    await toggleOccurrenceDone(it)
    return null
  }
  await updateItem(it.id, { done: status === 'done', doing: status === 'doing' ? true : undefined })
  return null
}

export { addDays }
