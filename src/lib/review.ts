import { addDays, differenceInCalendarDays } from 'date-fns'
import type { Item, Journal } from '../types'
import { parseYmd, ymd } from './date'
import { isAllDayOn, isTimed, taskKey, timedSegment } from './items'
import { expandItems, instance, isRecurring, resolveItem, updateSmart } from './recur'

export const blockMinutes = (it: Item) => (isTimed(it) ? Math.max(0, (new Date(it.end!).getTime() - new Date(it.start!).getTime()) / 60000) : 0)

/** 그날 끝낸 할 일 (반복 할 일은 그날 회차) */
export function doneOn(items: Item[], date: string): Item[] {
  const out: Item[] = []
  for (const it of items) {
    if (it.type !== 'task') continue
    if (isRecurring(it)) {
      if (it.doneDates?.includes(date)) out.push(instance(it, date))
    } else if (it.done && it.doneAt && ymd(new Date(it.doneAt)) === date) out.push(it)
  }
  return out
}

export type DayData = {
  date: string
  events: Item[]
  tasks: Item[] // 그날로 잡힌 할 일
  planned: Item[] // 아침에 계획한 항목 (없으면 그날 할 일)
  hasPlan: boolean
  plannedDone: Item[]
  unplannedDone: Item[]
  done: Item[]
  rate: number | null // 완료율 0~1
  plannedMinutes: number
  doneMinutes: number
  eventMinutes: number
}

export function dayData(items: Item[], date: string, journal?: Journal): DayData {
  const d = parseYmd(date)
  const expanded = expandItems(items, d, addDays(d, 1))
  const events = expanded
    .filter((it) => it.type === 'event' && (isAllDayOn(it, d) || timedSegment(it, d)))
    .sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
  const tasks = expanded.filter((it) => it.type === 'task' && taskKey(it) === date)
  const hasPlan = !!journal?.planned
  const planned = hasPlan ? journal!.planned!.map((id) => resolveItem(items, id)).filter((x): x is Item => !!x) : tasks
  const plannedIds = new Set(planned.map((p) => p.id))
  const done = doneOn(items, date)
  // 계획한 일 중 끝난 것: 그날 끝냈거나, 지금 완료 상태인 것
  const plannedDone = planned.filter((p) => p.done)
  const unplannedDone = done.filter((x) => !plannedIds.has(x.id))
  const eventMinutes = events.reduce((sum, e) => {
    const seg = timedSegment(e, d)
    return sum + (seg ? seg.endMin - seg.startMin : 0)
  }, 0)
  return {
    date,
    events,
    tasks,
    planned,
    hasPlan,
    plannedDone,
    unplannedDone,
    done,
    rate: planned.length ? plannedDone.length / planned.length : null,
    plannedMinutes: journal?.plannedMinutes ?? planned.reduce((s, p) => s + blockMinutes(p), 0),
    doneMinutes: [...plannedDone, ...unplannedDone].reduce((s, p) => s + blockMinutes(p), 0),
    eventMinutes,
  }
}

/** 어제까지 못 끝낸 할 일 (반복 제외) */
export function overdueTasks(items: Item[], today: string): Item[] {
  return items
    .filter((it) => it.type === 'task' && !it.done && !isRecurring(it) && (taskKey(it) ?? '9999') < today)
    .sort((a, b) => (taskKey(a) ?? '').localeCompare(taskKey(b) ?? ''))
}

export const inboxTasks = (items: Item[]) => items.filter((it) => it.type === 'task' && !it.done && !isRecurring(it) && !taskKey(it))

/** 다른 날로 옮기기 (시간 블록은 같은 시각 유지) */
export async function moveToDate(it: Item, date: string) {
  if (it.start) {
    const diff = differenceInCalendarDays(parseYmd(date), parseYmd(ymd(new Date(it.start))))
    const shift = (iso?: string) => (iso ? addDays(new Date(iso), diff).toISOString() : undefined)
    return updateSmart(it, { start: shift(it.start), end: shift(it.end), ...(it.due || it.type === 'task' ? { due: date } : {}) })
  }
  return updateSmart(it, { due: date })
}

export const moveToInbox = (it: Item) => updateSmart(it, { due: undefined, start: undefined, end: undefined, allDay: undefined })

export function fmtMinutes(m: number) {
  if (m <= 0) return '0분'
  const h = Math.floor(m / 60)
  const r = Math.round(m % 60)
  return h ? (r ? `${h}시간 ${r}분` : `${h}시간`) : `${r}분`
}

export const MOODS = ['😫', '😕', '😐', '🙂', '😄']
export const MOOD_LABEL = ['힘들었어요', '별로였어요', '그저 그래요', '좋았어요', '최고예요']
