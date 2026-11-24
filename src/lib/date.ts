import { addDays, differenceInCalendarDays, eachDayOfInterval, endOfWeek, format, isSameDay, startOfDay, startOfWeek } from 'date-fns'
import { ko } from 'date-fns/locale'

export const WEEK = { weekStartsOn: 1 as const, locale: ko }
export const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일']

export const ymd = (d: Date) => format(d, 'yyyy-MM-dd')

/** 'YYYY-MM-DD' → 로컬 0시 (new Date('YYYY-MM-DD')는 UTC로 해석되므로 쓰지 않는다) */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const toLocalInput = (iso: string) => format(new Date(iso), "yyyy-MM-dd'T'HH:mm")
export const hm = (d: Date) => format(d, 'HH:mm')

export function weekDays(d: Date): Date[] {
  return eachDayOfInterval({ start: startOfWeek(d, WEEK), end: endOfWeek(d, WEEK) })
}

export function atMinutes(day: Date, minutes: number): Date {
  const d = startOfDay(day)
  d.setMinutes(minutes)
  return d
}

/** 오늘/내일/어제/요일/날짜 형태의 짧은 상대 날짜 */
export function relDay(key: string, now = new Date()): string {
  const d = parseYmd(key)
  const diff = differenceInCalendarDays(d, now)
  if (diff === 0) return '오늘'
  if (diff === 1) return '내일'
  if (diff === -1) return '어제'
  if (diff > 1 && diff < 7) return format(d, 'EEEE', { locale: ko })
  if (d.getFullYear() === now.getFullYear()) return format(d, 'M월 d일')
  return format(d, 'yyyy년 M월 d일')
}

export { addDays, isSameDay, startOfDay }
