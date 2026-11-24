import { addMinutes, format, isValid } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { Item } from '../types'
import type { ExtractedItem } from './ai'
import { parseYmd, ymd } from './date'
import { parseQuick } from './parse'

/** 검토 화면에서 사용자가 고치는 임시 항목 */
export type Draft = {
  key: string
  include: boolean
  type: Item['type']
  title: string
  date: string // YYYY-MM-DD 또는 ''
  endDate: string
  startTime: string // HH:MM 또는 ''
  endTime: string
  location: string
  note: string
  tags: string
  uncertain: string[] // 확인이 필요한 필드
  reason: string
  source: string
}

let seq = 0
const k = () => `d${Date.now().toString(36)}${seq++}`

const isYmd = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && isValid(parseYmd(s)) && ymd(parseYmd(s)) === s
const isHm = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
const normTime = (s: string | null) => {
  if (!s) return ''
  const m = s.match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}

export function blankDraft(date = ymd(new Date())): Draft {
  return { key: k(), include: true, type: 'event', title: '', date, endDate: '', startTime: '', endTime: '', location: '', note: '', tags: '', uncertain: [], reason: '', source: '' }
}

export function fromExtracted(x: ExtractedItem): Draft {
  const date = x.date && isYmd(x.date) ? x.date : ''
  const map: Record<string, string> = { title: 'title', date: 'date', end_date: 'endDate', start_time: 'startTime', end_time: 'endTime', location: 'location' }
  const uncertain = new Set<string>(x.uncertain.map((f) => map[f] ?? f))
  if (x.date && !date) uncertain.add('date') // 형식이 이상한 날짜
  return {
    key: k(),
    include: true,
    type: x.type,
    title: x.title.trim(),
    date,
    endDate: x.end_date && isYmd(x.end_date) && x.end_date !== date ? x.end_date : '',
    startTime: normTime(x.start_time),
    endTime: normTime(x.end_time),
    location: x.location ?? '',
    note: x.note ?? '',
    tags: x.tags.join(', '),
    uncertain: [...uncertain],
    reason: x.uncertain_reason ?? '',
    source: x.source_text,
  }
}

/** API 키 없이도 동작: 한 줄에 하나씩 빠른 입력 문법으로 해석 */
export function fromPlainText(text: string): Draft[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d{1,2}[.)](?!\d))\s*/, '').trim())
    .filter((l) => l.length > 1)
    .map((line) => {
      const p = parseQuick(line)
      return {
        ...blankDraft(''),
        type: p.start ? 'event' : 'task',
        title: p.title,
        date: p.date ? ymd(p.date) : '',
        startTime: p.start ? hmStr(p.start) : '',
        endTime: p.end ? hmStr(p.end) : '',
        tags: p.tags.join(', '),
        source: line,
      } satisfies Draft
    })
}
const hmStr = (t: { h: number; m: number }) => `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`

/* ───────── .ics (다른 캘린더에서 내보낸 파일) — AI 없이 직접 해석 ───────── */
export function fromICS(text: string): Draft[] {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)
  const out: Draft[] = []
  let cur: Record<string, { params: string; value: string }> | null = null
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') cur = {}
    else if (line === 'END:VEVENT' && cur) {
      const d = icsEvent(cur)
      if (d) out.push(d)
      cur = null
    } else if (cur) {
      const m = line.match(/^([A-Z-]+)((?:;[^:]*)?):(.*)$/)
      if (m) cur[m[1]] = { params: m[2], value: m[3] }
    }
  }
  return out
}

const unesc = (s: string) => s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')

function icsDate(v?: { params: string; value: string }): { date: Date; allDay: boolean } | null {
  if (!v) return null
  const m = v.value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/)
  if (!m) return null
  const [, y, mo, d, h, mi, s, z] = m
  if (!h) return { date: new Date(+y, +mo - 1, +d), allDay: true }
  const date = z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))) : new Date(+y, +mo - 1, +d, +h, +mi, +(s ?? 0))
  return { date, allDay: false }
}

function icsEvent(p: Record<string, { params: string; value: string }>): Draft | null {
  const s = icsDate(p.DTSTART)
  if (!s) return null
  const e = icsDate(p.DTEND)
  const d: Draft = { ...blankDraft(ymd(s.date)), title: unesc(p.SUMMARY?.value ?? ''), location: unesc(p.LOCATION?.value ?? ''), note: unesc(p.DESCRIPTION?.value ?? ''), source: unesc(p.SUMMARY?.value ?? '') }
  if (s.allDay) {
    // ICS 종일 일정의 DTEND 는 '다음 날'이므로 하루 빼서 마지막 날로
    if (e) {
      const last = new Date(e.date.getTime() - 86400000)
      if (ymd(last) > d.date) d.endDate = ymd(last)
    }
  } else {
    d.startTime = format(s.date, 'HH:mm')
    if (e) {
      d.endTime = format(e.date, 'HH:mm')
      if (ymd(e.date) !== d.date) d.endDate = ymd(e.date)
    }
  }
  return d
}

/* ───────── 검증 ───────── */
export type Problems = Partial<Record<'title' | 'date' | 'endDate' | 'startTime' | 'endTime', string>>

export function validate(d: Draft): Problems {
  const p: Problems = {}
  if (!d.title.trim()) p.title = '제목을 입력해 주세요'
  if (d.date && !isYmd(d.date)) p.date = '날짜 형식이 올바르지 않아요'
  if (!d.date && (d.type === 'event' || d.startTime)) p.date = d.type === 'event' ? '일정에는 날짜가 필요해요' : '시간을 넣으려면 날짜가 필요해요'
  if (d.startTime && !isHm(d.startTime)) p.startTime = '시간 형식이 올바르지 않아요'
  if (d.endTime && !isHm(d.endTime)) p.endTime = '시간 형식이 올바르지 않아요'
  if (d.endTime && !d.startTime) p.startTime = '종료 시간만 있고 시작 시간이 없어요'
  if (d.endDate) {
    if (!isYmd(d.endDate)) p.endDate = '날짜 형식이 올바르지 않아요'
    else if (d.date && d.endDate < d.date) p.endDate = '종료일이 시작일보다 빨라요'
  }
  if (!p.date && !p.startTime && !p.endTime && d.date && d.startTime && d.endTime) {
    const s = `${d.date}T${d.startTime}`
    const e = `${d.endDate || d.date}T${d.endTime}`
    if (e <= s) p.endTime = '종료 시간이 시작 시간보다 빨라요'
  }
  return p
}

/** 요일과 날짜가 맞는지 등 참고용 안내 (저장은 가능) */
export function dateLabel(d: string): string {
  if (!isYmd(d)) return ''
  return format(parseYmd(d), 'EEE', { locale: ko })
}

export function draftToItem(d: Draft): Partial<Item> & Pick<Item, 'type'> {
  const tags = d.tags
    .split(/[,#\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  const note = [d.location && `장소: ${d.location}`, d.note].filter(Boolean).join('\n') || undefined
  const base = { type: d.type, title: d.title.trim(), tags: [...new Set(tags)], note }
  if (!d.date) return base // 날짜 없는 할 일 → 인박스
  const day = parseYmd(d.date)
  const lastDay = d.endDate ? parseYmd(d.endDate) : day
  if (d.startTime) {
    const [h, m] = d.startTime.split(':').map(Number)
    const s = new Date(day)
    s.setHours(h, m, 0, 0)
    let e: Date
    if (d.endTime) {
      const [eh, em] = d.endTime.split(':').map(Number)
      e = new Date(lastDay)
      e.setHours(eh, em, 0, 0)
    } else e = addMinutes(s, d.type === 'task' ? 30 : 60)
    return { ...base, start: s.toISOString(), end: e.toISOString(), ...(d.type === 'task' ? { due: d.date } : {}) }
  }
  if (d.type === 'task') return { ...base, due: d.date }
  return { ...base, allDay: true, start: day.toISOString(), end: lastDay.toISOString() }
}

/** 이미 같은 날 같은 제목이 있으면 중복 의심 */
export function findDuplicate(d: Draft, items: Item[]): Item | undefined {
  if (!d.date) return undefined
  const t = d.title.replace(/\s+/g, '').toLowerCase()
  if (!t) return undefined
  return items.find((it) => {
    const key = it.start ? ymd(new Date(it.start)) : it.due
    return key === d.date && it.title.replace(/\s+/g, '').toLowerCase() === t
  })
}
