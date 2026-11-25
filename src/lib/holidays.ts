// 한국 공휴일 (관공서의 공휴일에 관한 규정 기준) — 음력은 브라우저 내장 단기력으로 계산
import { create } from 'zustand'
import { addDays } from 'date-fns'
import { parseYmd, ymd } from './date'

export type HolidayKind = 'holiday' | 'substitute' | 'observance' | 'custom'
export type Holiday = { name: string; kind: HolidayKind }

/* ───────── 설정 (기기마다) ───────── */
export type HolidaySettings = { enabled: boolean; observances: boolean; custom: { date: string; name: string }[] }
const KEY = 'my-calendar.holidays'
const DEFAULTS: HolidaySettings = { enabled: true, observances: true, custom: [] }
function load(): HolidaySettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}
export const useHolidaySettings = create<HolidaySettings & { set: (p: Partial<HolidaySettings>) => void }>((set, get) => ({
  ...load(),
  set: (p) => {
    set(p)
    const { enabled, observances, custom } = get()
    try {
      localStorage.setItem(KEY, JSON.stringify({ enabled, observances, custom }))
    } catch {
      /* ignore */
    }
  },
}))

/* ───────── 음력 → 양력 (한 해치 표를 만들어 둠) ───────── */
let lunarFmt: Intl.DateTimeFormat | null | undefined
function lunarFormatter() {
  if (lunarFmt !== undefined) return lunarFmt
  try {
    const f = new Intl.DateTimeFormat('en-US-u-ca-dangi', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })
    // 단기력을 모르는 브라우저는 그레고리력으로 돌려준다 → 2024 설날로 확인
    const p = Object.fromEntries(f.formatToParts(new Date(Date.UTC(2024, 1, 10))).map((x) => [x.type, x.value]))
    lunarFmt = p.month === '1' && p.day === '1' ? f : null
  } catch {
    lunarFmt = null
  }
  return lunarFmt
}
export const lunarSupported = () => !!lunarFormatter()

/** 그해 양력 날짜 중 음력 month/day 인 날 (윤달 제외) */
export function lunarToSolar(year: number, month: number, day: number): Date | null {
  const f = lunarFormatter()
  if (!f) return null
  const want = `${month}/${day}`
  for (let t = Date.UTC(year, 0, 1); new Date(t).getUTCFullYear() === year; t += 864e5) {
    const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]))
    if (`${p.month}/${p.day}` === want) {
      const d = new Date(t)
      return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
    }
  }
  return null
}

/* 선거일·임시공휴일처럼 그때그때 정해지는 공휴일 (알려진 것만 — 새로 지정되면 설정에서 직접 추가) */
const ELECTIONS: Record<string, string> = {
  '2024-04-10': '국회의원선거',
  '2024-10-01': '임시공휴일 (국군의 날)',
  '2025-01-27': '임시공휴일',
  '2025-06-03': '대통령선거',
  '2026-06-03': '전국동시지방선거',
  '2028-04-12': '국회의원선거',
}

/* ───────── 한 해의 공휴일 계산 ───────── */
const cache = new Map<number, Map<string, Holiday[]>>()

export function holidaysOfYear(year: number): Map<string, Holiday[]> {
  const hit = cache.get(year)
  if (hit) return hit
  const map = new Map<string, Holiday[]>()
  const add = (d: Date, name: string, kind: HolidayKind = 'holiday') => {
    const k = ymd(d)
    map.set(k, [...(map.get(k) ?? []), { name, kind }])
  }
  const day = (m: number, d: number) => new Date(year, m - 1, d)

  // 대체공휴일 규칙: A = 설·추석(일요일·다른 공휴일과 겹칠 때), B = 토·일·다른 공휴일과 겹칠 때
  const ruleB = new Set<string>()
  const groupsA: Date[][] = []

  add(day(1, 1), '신정')
  for (const [m, d, name] of [
    [3, 1, '삼일절'],
    [5, 5, '어린이날'],
    [8, 15, '광복절'],
    [10, 3, '개천절'],
    [10, 9, '한글날'],
    [12, 25, '성탄절'],
  ] as const) {
    add(day(m, d), name)
    ruleB.add(name)
  }
  add(day(6, 6), '현충일')

  const seol = lunarToSolar(year, 1, 1)
  if (seol) {
    const g = [addDays(seol, -1), seol, addDays(seol, 1)]
    g.forEach((d, i) => add(d, i === 1 ? '설날' : '설날 연휴'))
    groupsA.push(g)
  }
  const buddha = lunarToSolar(year, 4, 8)
  if (buddha) {
    add(buddha, '부처님오신날')
    ruleB.add('부처님오신날')
  }
  const chuseok = lunarToSolar(year, 8, 15)
  if (chuseok) {
    const g = [addDays(chuseok, -1), chuseok, addDays(chuseok, 1)]
    g.forEach((d, i) => add(d, i === 1 ? '추석' : '추석 연휴'))
    groupsA.push(g)
  }
  for (const [k, name] of Object.entries(ELECTIONS)) if (k.startsWith(`${year}-`)) add(parseYmd(k), name)

  // 대체공휴일: 겹친 날마다 하나씩, 그 뒤 첫 평일(주말·공휴일 아님)
  const isOff = (d: Date) => d.getDay() === 0 || d.getDay() === 6 || map.has(ymd(d))
  const after: Date[] = []
  const inA = new Map<string, Date>() // 날짜 → 그 연휴의 마지막 날
  for (const g of groupsA) for (const d of g) inA.set(ymd(d), g[2])
  const doneGroups = new Set<string>()
  for (const [k, list] of [...map.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const d = parseYmd(k)
    const dow = d.getDay()
    const hasB = list.some((h) => ruleB.has(h.name))
    const endA = inA.get(k)
    const overlap = list.length >= 2 && (hasB || !!endA)
    const trigger = overlap || (dow === 0 && (hasB || !!endA)) || (dow === 6 && hasB)
    if (!trigger) continue
    if (endA) {
      // 설·추석 연휴는 한 번만, 연휴가 끝난 뒤부터 찾기
      const gk = ymd(endA)
      if (doneGroups.has(gk)) continue
      doneGroups.add(gk)
      after.push(endA)
    } else after.push(d)
  }
  for (const from of after.sort((a, b) => a.getTime() - b.getTime())) {
    let d = addDays(from, 1)
    while (isOff(d)) d = addDays(d, 1)
    add(d, '대체공휴일', 'substitute')
  }

  // 쉬는 날은 아니지만 달력에 흔히 표시하는 기념일
  add(day(5, 1), '노동절', 'observance')
  add(day(7, 17), '제헌절', 'observance')

  cache.set(year, map)
  return map
}

/** 그날의 공휴일·기념일 (설정 반영). 없으면 undefined */
export function holidayOn(d: Date | string, s: HolidaySettings = useHolidaySettings.getState()): { names: string[]; off: boolean } | undefined {
  if (!s.enabled && !s.custom.length) return
  const k = typeof d === 'string' ? d : ymd(d)
  const list = [...(s.enabled ? (holidaysOfYear(Number(k.slice(0, 4))).get(k) ?? []) : []), ...s.custom.filter((c) => c.date === k).map((c): Holiday => ({ name: c.name, kind: 'custom' }))].filter(
    (h) => h.kind !== 'observance' || s.observances,
  )
  if (!list.length) return
  return { names: [...new Set(list.map((h) => h.name))], off: list.some((h) => h.kind !== 'observance') }
}

/** 화면에서 쓰는 훅: 설정이 바뀌면 다시 그림 */
export function useHoliday() {
  const s = useHolidaySettings()
  return (d: Date | string) => holidayOn(d, s)
}

/** 날짜 색: 일요일·공휴일 = 빨강, 토요일 = 파랑 (모든 달력 화면에서 같은 규칙) */
export type DayTone = 'red' | 'blue' | undefined
export function dayTone(d: Date, hol?: { off: boolean }): DayTone {
  if (hol?.off || d.getDay() === 0) return 'red'
  if (d.getDay() === 6) return 'blue'
}
export const TONE_TEXT = { red: 'text-danger', blue: 'text-sat' } as const
/** 요일 이름(월~일) 색: 월요일 시작 기준 index 5 = 토, 6 = 일 */
export const weekdayTone = (i: number): DayTone => (i === 6 ? 'red' : i === 5 ? 'blue' : undefined)

/** 쉬는 날인지 (표시 설정과 상관없이 공휴일 계산 + 직접 추가한 휴일) — 반복 일정 건너뛰기용 */
export function isDayOff(key: string): boolean {
  if (holidaysOfYear(Number(key.slice(0, 4))).get(key)?.some((h) => h.kind !== 'observance')) return true
  return useHolidaySettings.getState().custom.some((c) => c.date === key)
}
