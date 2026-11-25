import { addDays } from 'date-fns'
import type { Item } from '../types'
import { parseYmd, ymd } from './date'
import { baseDate, instance, isRecurring, occurrences, toggleOccurrenceDone } from './recur'

/** 습관 = 반복 할 일 */
export const isHabit = (it: Item) => it.type === 'task' && isRecurring(it)

export type HabitStats = {
  scheduled: string[] // 오늘까지 해야 했던 날 (최근 3년)
  done: Set<string>
  current: number // 지금 이어지고 있는 연속 달성 (회차 기준)
  best: number
  rate30: number | null // 최근 30일 달성률
  total: number
  dueToday: boolean
  doneToday: boolean
}

export function habitStats(it: Item, now = new Date()): HabitStats {
  const today = ymd(now)
  const from = ymd(addDays(now, -1100))
  const base = baseDate(it)!
  const scheduled = occurrences(it, base > from ? base : from, today)
  const done = new Set(it.doneDates ?? [])
  const dueToday = scheduled.at(-1) === today
  const doneToday = done.has(today)

  // 연속 달성: 오늘 회차가 아직 안 끝났으면 어제까지로 센다
  let current = 0
  for (let i = scheduled.length - 1; i >= 0; i--) {
    const d = scheduled[i]
    if (d === today && !done.has(d)) continue
    if (!done.has(d)) break
    current++
  }
  let best = 0
  let run = 0
  for (const d of scheduled) {
    if (done.has(d)) best = Math.max(best, ++run)
    else if (d !== today) run = 0
  }

  const from30 = ymd(addDays(now, -29))
  const recent = scheduled.filter((d) => d >= from30 && (d !== today || done.has(d)))
  return {
    scheduled,
    done,
    current,
    best,
    rate30: recent.length ? recent.filter((d) => done.has(d)).length / recent.length : null,
    total: scheduled.filter((d) => done.has(d)).length,
    dueToday,
    doneToday,
  }
}

/** 특정 날짜 회차의 완료 체크를 바꾼다 (지난 날 채워 넣기 포함) */
export async function toggleHabitDay(it: Item, date: string) {
  if (!occurrences(it, date, date).length) return false
  await toggleOccurrenceDone(instance(it, date))
  return true
}

/** 히트맵용: 날짜 → 그날 해야 했던 습관 수 / 한 습관 수 */
export function dailyRatio(habits: Item[], from: string, to: string): Map<string, { due: number; done: number }> {
  const m = new Map<string, { due: number; done: number }>()
  for (const h of habits) {
    const done = new Set(h.doneDates ?? [])
    for (const d of occurrences(h, from, to)) {
      const cur = m.get(d) ?? { due: 0, done: 0 }
      cur.due++
      if (done.has(d)) cur.done++
      m.set(d, cur)
    }
  }
  return m
}

export const weeksBack = (now: Date, n: number) => {
  // n주 전 월요일부터
  const d = addDays(parseYmd(ymd(now)), -((now.getDay() + 6) % 7) - (n - 1) * 7)
  return d
}
