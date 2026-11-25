// 기념일·D-day: 다음 날짜 계산, 남은 날 표시, 캘린더에 보일 가상 일정
import { useMemo } from 'react'
import { addDays, differenceInCalendarDays, format, startOfDay } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useItems } from '../db'
import type { Item } from '../types'
import { parseYmd, ymd } from './date'
import { lunarToSolar } from './holidays'

export const isDday = (it: Item) => it.type === 'dday' && !!it.anniv?.date

/** 그해의 기념일 날짜 (음력이면 양력으로 바꿈, 음력 30일이 없는 해는 29일) */
function onYear(it: Item, year: number): Date | null {
  const a = it.anniv!
  const [, m, d] = a.date.split('-').map(Number)
  if (a.lunar) return lunarToSolar(year, m, d) ?? (d === 30 ? lunarToSolar(year, m, 29) : null)
  if (m === 2 && d === 29) {
    const leap = new Date(year, 1, 29)
    return leap.getMonth() === 1 ? leap : new Date(year, 1, 28) // 윤년 아니면 2/28
  }
  return new Date(year, m - 1, d)
}

export type DdayInfo = {
  item: Item
  date: Date // 다음(또는 그) 날짜
  diff: number // 오늘부터 며칠 (음수 = 지남)
  label: string // D-12, D-day, D+30
  sub: string // 2027. 3. 4 (목) · 31번째
}

export function ddayInfo(it: Item, now = new Date()): DdayInfo | null {
  const a = it.anniv
  if (!a?.date) return null
  const today = startOfDay(now)
  let date: Date | null
  if (a.yearly) {
    date = onYear(it, today.getFullYear())
    if (!date || date < today) date = onYear(it, today.getFullYear() + 1)
    if (!date) return null
  } else date = parseYmd(a.date)
  const diff = differenceInCalendarDays(date, today)
  const label = diff === 0 ? 'D-day' : diff > 0 ? `D-${diff}` : `D+${-diff}`
  const parts = [format(date, 'yyyy. M. d (EEE)', { locale: ko })]
  if (a.lunar) parts.push(`음력 ${Number(a.date.slice(5, 7))}/${Number(a.date.slice(8))}`)
  if (a.yearly && !a.noYear) {
    const n = date.getFullYear() - Number(a.date.slice(0, 4))
    if (n > 0) parts.push(`${n}번째`)
  }
  if (!a.yearly && diff < 0) parts.push(`${-diff + 1}일째`) // 시작한 날을 1일로 셈
  return { item: it, date, diff, label, sub: parts.join(' · ') }
}

/** 다가오는 순서 (지난 1회성 기념일은 뒤로) */
export function sortDdays(items: Item[], now = new Date()): DdayInfo[] {
  return items
    .filter(isDday)
    .map((it) => ddayInfo(it, now))
    .filter((x): x is DdayInfo => !!x)
    .sort((a, b) => Number(a.diff < 0) - Number(b.diff < 0) || (a.diff < 0 ? b.diff - a.diff : a.diff - b.diff))
}

export function useDdays(): DdayInfo[] {
  const items = useItems()
  const key = ymd(new Date())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => sortDdays(items), [items, key])
}

/** 캘린더에 그릴 가상 종일 일정 (작년~내후년). id 는 'dday:원래id:날짜' */
export function ddayCalendarItems(items: Item[], now = new Date()): Item[] {
  const y = now.getFullYear()
  const out: Item[] = []
  for (const it of items) {
    if (!isDday(it)) continue
    const dates = it.anniv!.yearly ? [y - 1, y, y + 1, y + 2].map((yy) => onYear(it, yy)).filter((d): d is Date => !!d) : [parseYmd(it.anniv!.date)]
    for (const d of dates) {
      const iso = startOfDay(d).toISOString()
      out.push({
        ...it,
        id: `dday:${it.id}:${ymd(d)}`,
        type: 'event',
        title: `${it.icon ?? '🎉'} ${it.title || '기념일'}`,
        allDay: true,
        start: iso,
        end: iso,
        readonly: { subId: 'dday', name: '기념일' },
      })
    }
  }
  return out
}

/** 가상 일정 id → 원래 기념일 id */
export const ddayIdOf = (id: string) => (id.startsWith('dday:') ? id.split(':')[1] : null)

export const DDAY_ICONS = ['🎂', '💝', '🎓', '✈️', '💍', '👶', '🏃', '📚', '🎉', '⭐'] as const
export const nextWeek = (d: DdayInfo) => d.diff >= 0 && d.diff <= 7
export const daysFromNow = (n: number) => ymd(addDays(new Date(), n))
