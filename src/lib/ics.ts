import { addDays, addMinutes } from 'date-fns'
import type { Item, NotionColor, Repeat } from '../types'
import { ymd } from './date'

/**
 * iCalendar(.ics) → 읽기 전용 일정
 * - 반복(RRULE): 매일/매주(요일)/매월(날짜·n번째 요일)/매년 + INTERVAL/COUNT/UNTIL
 * - EXDATE(빠진 회차), RECURRENCE-ID(특정 회차만 바뀐 일정), STATUS:CANCELLED
 * - 시간대: UTC(Z), TZID(IANA 또는 Windows 이름), 지정 없음(로컬)
 */

type Prop = { params: Record<string, string>; value: string }
type VEvent = Record<string, Prop[]>

/* ───────── 시간대 ───────── */
// Outlook/Exchange 가 쓰는 Windows 시간대 이름 → IANA
const WINDOWS_TZ: Record<string, string> = {
  'Korea Standard Time': 'Asia/Seoul',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'China Standard Time': 'Asia/Shanghai',
  'Taipei Standard Time': 'Asia/Taipei',
  'Singapore Standard Time': 'Asia/Singapore',
  'India Standard Time': 'Asia/Kolkata',
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'AUS Eastern Standard Time': 'Australia/Sydney',
}

function resolveTz(tzid?: string): string | null {
  if (!tzid) return null
  const t = tzid.replace(/^"|"$/g, '').replace(/^\/[^/]+\//, '') // "/mozilla.org/.../Asia/Seoul" 같은 접두어 제거
  const cand = WINDOWS_TZ[t] ?? t
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: cand })
    return cand
  } catch {
    return null
  }
}

/** 그 시간대에서의 벽시계 시각 → 실제 시각 */
function zonedToDate(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  const offset = (t: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
        .formatToParts(new Date(t))
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, Number(p.value)]),
    )
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second) - t
  }
  let t = guess - offset(guess)
  t = guess - offset(t) // 일광절약시간 경계 보정
  return new Date(t)
}

function parseDate(p?: Prop): { date: Date; allDay: boolean } | null {
  if (!p) return null
  const m = p.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  if (!h || p.params.VALUE === 'DATE') return { date: new Date(+y, +mo - 1, +d), allDay: true }
  if (z) return { date: new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))), allDay: false }
  const tz = resolveTz(p.params.TZID)
  if (tz) return { date: zonedToDate(+y, +mo, +d, +h, +mi, +(s ?? 0), tz), allDay: false }
  return { date: new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0)), allDay: false }
}

/** EXDATE 같은 여러 값 → 로컬 날짜들 */
function parseDateList(props: Prop[] = []): string[] {
  const out: string[] = []
  for (const p of props)
    for (const v of p.value.split(',')) {
      const r = parseDate({ params: p.params, value: v.trim() })
      if (r) out.push(ymd(r.date))
    }
  return out
}

function parseDuration(v?: string): number | null {
  const m = v?.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!m) return null
  const [, sign, w, d, h, mi, s] = m
  const min = (+(w ?? 0) * 7 + +(d ?? 0)) * 1440 + +(h ?? 0) * 60 + +(mi ?? 0) + Math.round(+(s ?? 0) / 60)
  return sign === '-' ? -min : min
}

const unesc = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

/* ───────── 반복 규칙 ───────── */
const DAYS: Record<string, number> = { MO: 0, TU: 1, WE: 2, TH: 3, FR: 4, SA: 5, SU: 6 }

/** RRULE → 앱의 반복 규칙. 지원 못 하는 규칙이면 null */
function parseRRule(v: string, start: Date): Repeat | null {
  const r = Object.fromEntries(v.split(';').map((kv) => kv.split('=') as [string, string]))
  const freq = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[r.FREQ as string] as Repeat['freq'] | undefined
  if (!freq) return null
  if (r.BYSETPOS || r.BYHOUR || r.BYMINUTE || r.BYWEEKNO || r.BYYEARDAY) return null
  const out: Repeat = { freq, interval: Math.max(1, Number(r.INTERVAL) || 1) }
  if (r.COUNT) out.count = Number(r.COUNT)
  if (r.UNTIL) {
    const u = parseDate({ params: {}, value: r.UNTIL })
    if (u) out.until = ymd(u.date)
  }
  const byDay = r.BYDAY?.split(',') ?? []
  if (freq === 'daily' && byDay.length) {
    // "매일인데 평일만" 같은 규칙 → 매주 해당 요일
    out.freq = 'weekly'
    out.byDay = byDay.map((d) => DAYS[d.slice(-2)]).filter((x) => x !== undefined).sort()
  } else if (freq === 'weekly') {
    if (byDay.length) out.byDay = byDay.map((d) => DAYS[d.slice(-2)]).filter((x) => x !== undefined).sort()
  } else if (freq === 'monthly') {
    if (byDay.length === 1) {
      const m = byDay[0].match(/^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/)
      const n = m?.[1] ? Number(m[1]) : NaN
      if (!m || !(n === -1 || (n >= 1 && n <= 4)) || DAYS[m[2]] !== (start.getDay() + 6) % 7) return null
      out.monthly = 'nth'
      out.nth = n
    } else if (byDay.length > 1) return null
    else if (r.BYMONTHDAY && Number(r.BYMONTHDAY) !== start.getDate()) return null
    else out.monthly = 'day'
  } else if (freq === 'yearly') {
    if (byDay.length || (r.BYMONTH && Number(r.BYMONTH) !== start.getMonth() + 1)) return null
  }
  return out
}

/* ───────── 파일 읽기 ───────── */
function readEvents(text: string): VEvent[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n')
  const out: VEvent[] = []
  let cur: VEvent | null = null
  let depth = 0 // VEVENT 안의 VALARM 등은 건너뜀
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {}
      depth = 0
      continue
    }
    if (!cur) continue
    if (line === 'END:VEVENT') {
      out.push(cur)
      cur = null
      continue
    }
    if (line.startsWith('BEGIN:')) depth++
    else if (line.startsWith('END:')) depth--
    else if (depth === 0) {
      const i = line.indexOf(':')
      if (i < 0) continue
      const [name, ...ps] = line.slice(0, i).split(';')
      const params = Object.fromEntries(ps.map((x) => x.split('=') as [string, string]))
      ;(cur[name.toUpperCase()] ??= []).push({ params, value: line.slice(i + 1) })
    }
  }
  return out
}

export type ParsedCalendar = { items: Item[]; name?: string; total: number; unsupported: number }

export function parseICS(text: string, sub: { id: string; name: string; color: NotionColor }, now = new Date()): ParsedCalendar {
  if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('iCal(.ics) 형식이 아니에요. 주소가 맞는지 확인해 주세요.')
  const calName = text.match(/^X-WR-CALNAME:(.*)$/m)?.[1]?.trim()
  const events = readEvents(text)
  const keepFrom = ymd(addDays(now, -365)) // 1년 넘게 지난 단일 일정은 버린다
  const byUid = new Map<string, Item>()
  const overrides: { uid: string; date: string; item: Item | null }[] = []
  let unsupported = 0
  const stamp = now.toISOString()

  for (const ev of events) {
    const one = (k: string) => ev[k]?.[0]
    const uid = one('UID')?.value ?? `${one('DTSTART')?.value}-${one('SUMMARY')?.value}`
    const s = parseDate(one('DTSTART'))
    if (!s) continue
    let end: Date
    const e = parseDate(one('DTEND'))
    const dur = parseDuration(one('DURATION')?.value)
    if (e) end = s.allDay ? addDays(e.date, -1) : e.date
    else if (dur !== null) end = s.allDay ? addDays(s.date, Math.max(0, Math.round(dur / 1440) - 1)) : addMinutes(s.date, dur)
    else end = s.allDay ? s.date : s.date
    if (!s.allDay && end <= s.date) end = addMinutes(s.date, 30)
    if (s.allDay && end < s.date) end = s.date

    const cancelled = one('STATUS')?.value?.toUpperCase() === 'CANCELLED'
    const location = one('LOCATION')?.value ? unesc(one('LOCATION')!.value) : ''
    const desc = one('DESCRIPTION')?.value ? unesc(one('DESCRIPTION')!.value).trim() : ''
    const recurId = one('RECURRENCE-ID')
    const base: Item = {
      id: `sub:${sub.id}:${uid}${recurId ? `:${recurId.value}` : ''}`,
      type: 'event',
      title: one('SUMMARY')?.value ? unesc(one('SUMMARY')!.value) : '(제목 없음)',
      start: s.date.toISOString(),
      end: end.toISOString(),
      allDay: s.allDay || undefined,
      note: [location && `장소: ${location}`, desc].filter(Boolean).join('\n') || undefined,
      tags: [],
      color: sub.color,
      readonly: { subId: sub.id, name: sub.name },
      createdAt: stamp,
      updatedAt: stamp,
    }

    if (recurId) {
      const r = parseDate(recurId)
      if (r) overrides.push({ uid, date: ymd(r.date), item: cancelled ? null : base })
      continue
    }
    if (cancelled) continue

    const rr = one('RRULE')?.value
    if (rr) {
      const repeat = parseRRule(rr, s.date)
      if (repeat) {
        base.repeat = repeat
        const ex = parseDateList(ev.EXDATE)
        if (ex.length) base.exdates = ex
      } else {
        unsupported++
        base.note = [base.note, '※ 이 일정의 반복 규칙은 지원하지 않아 첫 회차만 보여요.'].filter(Boolean).join('\n')
      }
    }
    if (!base.repeat && ymd(end) < keepFrom) continue
    if (base.repeat?.until && base.repeat.until < keepFrom) continue
    byUid.set(uid, base)
  }

  // 특정 회차만 바뀐/취소된 일정: 원래 회차는 빼고 바뀐 일정은 따로 넣는다
  const extra: Item[] = []
  for (const o of overrides) {
    const master = byUid.get(o.uid)
    if (master?.repeat) master.exdates = [...new Set([...(master.exdates ?? []), o.date])]
    if (o.item && ymd(new Date(o.item.end!)) >= keepFrom) extra.push(o.item)
  }

  const items = [...byUid.values(), ...extra]
  return { items, name: calName, total: events.length, unsupported }
}
