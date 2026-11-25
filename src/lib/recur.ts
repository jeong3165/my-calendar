import { addDays, addMonths, addYears, differenceInCalendarDays, format, getDaysInMonth, startOfMonth, startOfWeek } from 'date-fns'
import { ko } from 'date-fns/locale'
import { createItem, db, deleteItem, updateItem } from '../db'
import { useUI } from '../store'
import type { Item, Repeat } from '../types'
import { parseYmd, ymd } from './date'

/* ───────── 반복 회차 계산 ───────── */

/** 반복의 기준 날짜: 시간이 있으면 시작일, 없으면 마감일 */
export const baseDate = (it: Item): string | undefined => (it.start ? ymd(new Date(it.start)) : it.due)
export const isRecurring = (it: Item) => !!it.repeat && !!baseDate(it)

const MAX_STEPS = 20000

/**
 * [from, to] 사이의 회차 날짜들 (YYYY-MM-DD, 오름차순)
 * includeExcluded: 건너뛴 날짜도 포함 (횟수 계산용)
 */
export function occurrences(it: Item, from: string, to: string, opts: { max?: number; includeExcluded?: boolean } = {}): string[] {
  const r = it.repeat
  const base = baseDate(it)
  if (!r || !base) return []
  const D0 = parseYmd(base)
  const iv = Math.max(1, Math.floor(r.interval || 1))
  const ex = new Set(opts.includeExcluded ? [] : (it.exdates ?? []))
  const out: string[] = []
  let n = 0
  let steps = 0
  /** false 를 돌려주면 생성 종료 */
  const emit = (d: Date): boolean => {
    if (++steps > MAX_STEPS) return false
    const k = ymd(d)
    if (k < base) return true
    if (r.until && k > r.until) return false
    if (k > to) return false
    n++
    if (r.count && n > r.count) return false
    if (k >= from && !ex.has(k)) {
      out.push(k)
      if (opts.max && out.length >= opts.max) return false
    }
    return true
  }
  /** 해당 달/해에 날짜가 없어서 건너뛸 때도 종료 조건은 확인 */
  const past = (d: Date) => ++steps > MAX_STEPS || ymd(d) > to || (!!r.until && ymd(d) > r.until)

  switch (r.freq) {
    case 'daily':
      for (let i = 0; ; i += iv) if (!emit(addDays(D0, i))) break
      break
    case 'weekly': {
      const days = r.byDay?.length ? [...new Set(r.byDay)].sort() : [(D0.getDay() + 6) % 7]
      const ws = startOfWeek(D0, { weekStartsOn: 1 })
      outer: for (let w = 0; ; w += iv) for (const bd of days) if (!emit(addDays(ws, w * 7 + bd))) break outer
      break
    }
    case 'monthly': {
      const m0 = startOfMonth(D0)
      const dom = D0.getDate()
      const nth = r.nth ?? defaultNth(base)
      const wd = D0.getDay()
      for (let i = 0; ; i += iv) {
        const m = addMonths(m0, i)
        let d: Date | null
        if (r.monthly === 'nth') {
          if (nth === -1) {
            d = new Date(m.getFullYear(), m.getMonth(), getDaysInMonth(m))
            while (d.getDay() !== wd) d = addDays(d, -1)
          } else {
            d = new Date(m)
            while (d.getDay() !== wd) d = addDays(d, 1)
            d = addDays(d, (nth - 1) * 7)
          }
        } else d = dom <= getDaysInMonth(m) ? new Date(m.getFullYear(), m.getMonth(), dom) : null
        if (d) {
          if (!emit(d)) break
        } else if (past(m)) break
      }
      break
    }
    case 'yearly':
      for (let i = 0; ; i += iv) {
        const d = addYears(D0, i)
        if (d.getDate() === D0.getDate()) {
          if (!emit(d)) break
        } else if (past(d)) break // 2월 29일 → 윤년만
      }
      break
  }
  return out
}

/** 특정 회차를 화면용 항목으로 */
export function instance(it: Item, date: string): Item {
  const diff = differenceInCalendarDays(parseYmd(date), parseYmd(baseDate(it)!))
  const shift = (iso?: string) => (iso ? addDays(new Date(iso), diff).toISOString() : undefined)
  return {
    ...it,
    id: `${it.id}::${date}`,
    start: shift(it.start),
    end: shift(it.end),
    due: it.due ? ymd(addDays(parseYmd(it.due), diff)) : undefined,
    done: it.type === 'task' ? (it.doneDates ?? []).includes(date) : it.done,
    occ: { seriesId: it.id, date },
  }
}

/** 반복 항목을 [from, to) 범위의 회차들로 펼친다 (반복 아닌 항목은 그대로) */
export function expandItems(items: Item[], from: Date, to: Date): Item[] {
  // 여러 날에 걸친 일정이 범위 앞에서 시작할 수 있어 조금 앞에서부터 계산
  const f = ymd(addDays(from, -7))
  const t = ymd(addDays(to, -1))
  const out: Item[] = []
  for (const it of items) {
    if (!isRecurring(it)) out.push(it)
    else for (const d of occurrences(it, f, t)) out.push(instance(it, d))
  }
  return out
}

export function nextOccurrence(it: Item, fromKey: string): string | undefined {
  return occurrences(it, fromKey, ymd(addYears(parseYmd(fromKey), 10)), { max: 1 })[0]
}

export function parseOccId(id: string): { seriesId: string; date: string } | null {
  const i = id.lastIndexOf('::')
  return i > 0 ? { seriesId: id.slice(0, i), date: id.slice(i + 2) } : null
}

/** 아이디(회차 아이디 포함)로 항목 찾기 */
export function resolveItem(items: Item[], id: string): Item | undefined {
  const hit = items.find((x) => x.id === id)
  if (hit) return hit
  const o = parseOccId(id)
  if (!o) return undefined
  const s = items.find((x) => x.id === o.seriesId)
  return s && isRecurring(s) ? instance(s, o.date) : undefined
}

/* ───────── 표시용 문구 ───────── */
const WD = ['월', '화', '수', '목', '금', '토', '일']
const NTH = ['첫째', '둘째', '셋째', '넷째', '마지막']

/** 기준일이 그 달의 몇 번째 요일인지 (5번째면 '마지막' = -1) */
export function defaultNth(base: string) {
  const n = Math.ceil(parseYmd(base).getDate() / 7)
  return n >= 5 ? -1 : n
}
/** 기준일이 그 달의 마지막 해당 요일인지 */
export const isLastWeekday = (base: string) => parseYmd(base).getDate() + 7 > getDaysInMonth(parseYmd(base))

export function monthlyNthLabel(base: string, nth = defaultNth(base)) {
  return `${nth === -1 ? NTH[4] : NTH[nth - 1]} ${format(parseYmd(base), 'EEEE', { locale: ko })}`
}

export function repeatLabel(r: Repeat, base?: string): string {
  const iv = Math.max(1, r.interval || 1)
  const d = base ? parseYmd(base) : new Date()
  let s: string
  switch (r.freq) {
    case 'daily':
      s = iv === 1 ? '매일' : `${iv}일마다`
      break
    case 'weekly': {
      const days = r.byDay?.length ? [...r.byDay].sort() : [(d.getDay() + 6) % 7]
      const names = days.join() === '0,1,2,3,4' ? '평일' : days.join() === '5,6' ? '주말' : days.map((x) => WD[x]).join('·')
      s = `${iv === 1 ? '매주' : iv === 2 ? '격주' : `${iv}주마다`} ${names}`
      break
    }
    case 'monthly':
      s = `${iv === 1 ? '매월' : `${iv}개월마다`} ${r.monthly === 'nth' && base ? monthlyNthLabel(base, r.nth) : `${d.getDate()}일`}`
      break
    case 'yearly':
      s = `${iv === 1 ? '매년' : `${iv}년마다`} ${format(d, 'M월 d일')}`
      break
  }
  if (r.until) s += ` · ${format(parseYmd(r.until), 'yyyy년 M월 d일')}까지`
  else if (r.count) s += ` · ${r.count}회`
  return s
}

/* ───────── 회차 수정/삭제 (이 일정만 / 이후 모두 / 전체) ───────── */
export type Scope = 'this' | 'following' | 'all'

const TIME_KEYS = ['start', 'end', 'allDay', 'due'] as const
export const touchesTime = (patch: Partial<Item>) => TIME_KEYS.some((k) => k in patch)

/** 저장할 때 화면용 필드 제거 */
function strip(it: Item): Omit<Item, 'id' | 'occ' | 'createdAt' | 'updatedAt'> {
  const { id: _id, occ: _occ, createdAt: _c, updatedAt: _u, ...rest } = it
  return rest
}

/** 회차 날짜가 바뀐 만큼 매주 요일도 옮긴다 */
function shiftRepeat(r: Repeat, dayShift: number): Repeat {
  if (r.freq !== 'weekly' || !r.byDay?.length || dayShift % 7 === 0) return r
  return { ...r, byDay: r.byDay.map((b) => (((b + dayShift) % 7) + 7) % 7).sort() }
}

/**
 * 회차 하나를 고쳤을 때 범위에 따라 저장. 새로 생긴 항목의 id 를 돌려준다.
 */
export async function changeOccurrence(inst: Item, patch: Partial<Item>, scope: Scope): Promise<string | undefined> {
  const series = await db.items.get(inst.occ!.seriesId)
  if (!series?.repeat) return
  const date = inst.occ!.date
  const next: Item = { ...inst, ...patch }
  const newKey = baseDate(next) ?? date
  const dayShift = differenceInCalendarDays(parseYmd(newKey), parseYmd(date))

  if (scope === 'this') {
    await updateItem(series.id, { exdates: [...new Set([...(series.exdates ?? []), date])].sort() })
    const created = await createItem({ ...strip(next), repeat: undefined, exdates: undefined, doneDates: undefined, done: next.type === 'task' ? !!next.done : undefined })
    return created.id
  }

  if (scope === 'all' || date === baseDate(series)) {
    // 이 회차에서 바뀐 만큼 반복 전체를 옮긴다
    const moved = (key: 'start' | 'end') => {
      if (!(key in patch)) return series[key]
      const newV = next[key]
      if (!newV) return undefined
      // 시간이 새로 생긴 경우: 같은 시각을 반복 기준일 쪽으로 옮긴다
      if (!inst[key] || !series[key]) return addDays(new Date(newV), differenceInCalendarDays(parseYmd(baseDate(series)!), parseYmd(date))).toISOString()
      return shiftIso(series[key]!, newV, inst[key]!)
    }
    const nonTime = Object.fromEntries(Object.entries(patch).filter(([k]) => !TIME_KEYS.includes(k as (typeof TIME_KEYS)[number])))
    await updateItem(series.id, {
      ...nonTime,
      start: moved('start'),
      end: moved('end'),
      allDay: 'allDay' in patch ? next.allDay : series.allDay,
      due: 'due' in patch ? (next.due ? ymd(addDays(parseYmd(series.due ?? next.due), differenceInCalendarDays(parseYmd(next.due), parseYmd(inst.due ?? next.due)))) : undefined) : series.due,
      repeat: shiftRepeat(series.repeat, dayShift),
    })
    return
  }

  // 이후 모두: 기존 반복은 전날까지, 이 회차부터 새 반복
  const prior = occurrences(series, baseDate(series)!, ymd(addDays(parseYmd(date), -1)), { includeExcluded: true }).length
  await updateItem(series.id, { repeat: { ...series.repeat, until: ymd(addDays(parseYmd(date), -1)), count: undefined } })
  const created = await createItem({
    ...strip(next),
    repeat: shiftRepeat({ ...series.repeat, count: series.repeat.count ? Math.max(1, series.repeat.count - prior) : undefined }, dayShift),
    exdates: (series.exdates ?? []).filter((d) => d >= date),
    doneDates: (series.doneDates ?? []).filter((d) => d >= date),
    done: undefined,
  })
  return created.id
}

/** 회차 기준으로 바뀐 시간 차이를 반복 원본에 적용 */
function shiftIso(seriesIso: string, newInstIso: string, oldInstIso: string) {
  const dayDiff = differenceInCalendarDays(new Date(newInstIso), new Date(oldInstIso))
  const a = new Date(oldInstIso)
  const b = new Date(newInstIso)
  const minDiff = b.getHours() * 60 + b.getMinutes() - (a.getHours() * 60 + a.getMinutes())
  const d = addDays(new Date(seriesIso), dayDiff)
  d.setMinutes(d.getMinutes() + minDiff)
  return d.toISOString()
}

export async function deleteOccurrence(inst: Item, scope: Scope) {
  const series = await db.items.get(inst.occ!.seriesId)
  if (!series?.repeat) return
  const date = inst.occ!.date
  if (scope === 'all' || (scope === 'following' && date === baseDate(series))) return deleteItem(series.id)
  if (scope === 'this') return updateItem(series.id, { exdates: [...new Set([...(series.exdates ?? []), date])].sort() })
  return updateItem(series.id, { repeat: { ...series.repeat, until: ymd(addDays(parseYmd(date), -1)), count: undefined } })
}

export async function toggleOccurrenceDone(inst: Item) {
  const series = await db.items.get(inst.occ!.seriesId)
  if (!series) return
  const set = new Set(series.doneDates ?? [])
  if (set.has(inst.occ!.date)) set.delete(inst.occ!.date)
  else set.add(inst.occ!.date)
  // 오래된 완료 기록은 3년치만 유지 (습관 최고 기록 계산용)
  const cutoff = ymd(addDays(new Date(), -1100))
  await updateItem(series.id, { doneDates: [...set].filter((d) => d >= cutoff).sort() })
}

/** 회차면 범위를 물어보고, 아니면 바로 저장. 새로 생긴 항목 id 를 돌려준다. */
export async function updateSmart(it: Item, patch: Partial<Item>): Promise<string | undefined> {
  if (it.readonly) return // 구독 캘린더 일정은 읽기 전용
  if (!it.occ) {
    await updateItem(it.id, patch)
    return
  }
  if (!touchesTime(patch)) {
    await updateItem(it.occ.seriesId, patch)
    return
  }
  const scope = await useUI.getState().askScope('change')
  if (!scope) return
  return changeOccurrence(it, patch, scope)
}

export async function deleteSmart(it: Item): Promise<boolean> {
  if (it.readonly) return false
  if (!it.occ) {
    await deleteItem(it.id)
    return true
  }
  const scope = await useUI.getState().askScope('delete')
  if (!scope) return false
  await deleteOccurrence(it, scope)
  return true
}
