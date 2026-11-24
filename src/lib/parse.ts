import { addDays, addMinutes, startOfDay, startOfWeek } from 'date-fns'
import type { Item, Priority } from '../types'
import { ymd } from './date'

/**
 * 한국어 빠른 입력 해석기
 *   "내일 3시 치과 #건강 !높음"
 *   "다음주 금요일 오후 2시~4시 회의 #회사"
 *   "11월 30일 보고서 마감 !높음"
 */
export type Parsed = {
  title: string
  date?: Date
  start?: { h: number; m: number }
  end?: { h: number; m: number }
  tags: string[]
  priority?: Priority
}

const WD: Record<string, number> = { 월: 0, 화: 1, 수: 2, 목: 3, 금: 4, 토: 5, 일: 6 } // 월요일 기준 offset

const PRIO: Record<string, Priority> = {
  높음: 'high', 높: 'high', 상: 'high', high: 'high', h: 'high', '1': 'high',
  보통: 'normal', 중: 'normal', normal: 'normal', n: 'normal', '2': 'normal',
  낮음: 'low', 낮: 'low', 하: 'low', low: 'low', l: 'low', '3': 'low',
}

const TIME = String.raw`(?:(오전|오후|아침|낮|저녁|밤)\s*)?(\d{1,2})(?:시(?:\s*(\d{1,2})\s*분|\s*(반))?|:(\d{2}))`

function toHM(m: RegExpMatchArray, offset: number): { h: number; m: number } | null {
  const ampm = m[offset]
  let h = Number(m[offset + 1])
  const isColon = m[offset + 4] !== undefined
  const min = isColon ? Number(m[offset + 4]) : m[offset + 2] ? Number(m[offset + 2]) : m[offset + 3] ? 30 : 0
  if (h > 24 || min > 59) return null
  if (ampm === '오후' || ampm === '저녁' || ampm === '밤') {
    if (h < 12) h += 12
  } else if (ampm === '오전' || ampm === '아침') {
    if (h === 12) h = 0
  } else if (ampm === '낮') {
    if (h <= 6) h += 12
  } else if (!isColon && h >= 1 && h <= 7) {
    h += 12 // "3시" → 보통 오후 3시
  }
  return { h: h % 24, m: min }
}

export function parseQuick(input: string, now = new Date()): Parsed {
  let s = ` ${input} `
  const tags: string[] = []
  let priority: Priority | undefined
  let date: Date | undefined
  const today = startOfDay(now)

  s = s.replace(/#([^\s#!]+)/g, (_, t: string) => {
    if (!tags.includes(t)) tags.push(t)
    return ' '
  })
  s = s.replace(/(^|\s)!(높음|높|상|high|h|보통|중|normal|n|낮음|낮|하|low|l|[123])(?=\s)/gi, (_, sp: string, p: string) => {
    priority = PRIO[p.toLowerCase()]
    return sp
  })

  const rules: [RegExp, (m: RegExpMatchArray) => Date | null][] = [
    [/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/, (m) => new Date(+m[1], +m[2] - 1, +m[3])],
    [
      /(\d{1,2})월\s*(\d{1,2})일/,
      (m) => {
        const d = new Date(today.getFullYear(), +m[1] - 1, +m[2])
        return d < today ? new Date(today.getFullYear() + 1, +m[1] - 1, +m[2]) : d
      },
    ],
    [
      /(?<![\d:/])(\d{1,2})\/(\d{1,2})(?![\d/])/,
      (m) => {
        const d = new Date(today.getFullYear(), +m[1] - 1, +m[2])
        return d < today ? new Date(today.getFullYear() + 1, +m[1] - 1, +m[2]) : d
      },
    ],
    [
      /(다다음\s?주|다음\s?주|이번\s?주|담주)\s*([월화수목금토일])(?:요일)?/,
      (m) => {
        const weeks = m[1].startsWith('다다음') ? 2 : m[1].startsWith('이번') ? 0 : 1
        return addDays(startOfWeek(today, { weekStartsOn: 1 }), weeks * 7 + WD[m[2]])
      },
    ],
    [/(\d+)\s*일\s*(?:후|뒤)/, (m) => addDays(today, +m[1])],
    [/(오늘|금일)/, () => today],
    [/(내일|낼)/, () => addDays(today, 1)],
    [/(모레)/, () => addDays(today, 2)],
    [/(글피)/, () => addDays(today, 3)],
    [
      /(?<![가-힣])([월화수목금토일])요일/,
      (m) => {
        const cur = (today.getDay() + 6) % 7
        let diff = WD[m[1]] - cur
        if (diff < 0) diff += 7
        return addDays(today, diff)
      },
    ],
    [
      /(?<![\d월])(\d{1,2})일(?![가-힣\d])/,
      (m) => {
        const d = new Date(today.getFullYear(), today.getMonth(), +m[1])
        return d < today ? new Date(today.getFullYear(), today.getMonth() + 1, +m[1]) : d
      },
    ],
  ]
  for (const [re, fn] of rules) {
    const m = s.match(re)
    if (!m) continue
    const d = fn(m)
    if (d && !isNaN(d.getTime())) {
      date = d
      s = s.replace(m[0], ' ')
      break
    }
  }

  let start: Parsed['start']
  let end: Parsed['end']
  const range = s.match(new RegExp(`${TIME}\\s*[-~]\\s*${TIME}`))
  if (range) {
    start = toHM(range, 1) ?? undefined
    end = toHM(range, 6) ?? undefined
    if (start && end && !range[6] && end.h * 60 + end.m <= start.h * 60 + start.m && end.h < 12) end = { h: end.h + 12, m: end.m }
    s = s.replace(range[0], ' ')
  } else {
    const one = s.match(new RegExp(`(?<![\\d])${TIME}`))
    if (one) {
      start = toHM(one, 1) ?? undefined
      if (start) s = s.replace(one[0], ' ')
    }
  }
  if (start && !date) date = today

  return { title: s.replace(/\s+/g, ' ').trim(), date, start, end, tags, priority }
}

/** 해석 결과 → Item 필드 */
export function parsedToItem(p: Parsed, type: Item['type']): Partial<Item> {
  const out: Partial<Item> = { title: p.title, tags: p.tags }
  if (p.priority) out.priority = p.priority
  if (!p.date) return out
  if (p.start) {
    const s = new Date(p.date)
    s.setHours(p.start.h, p.start.m, 0, 0)
    let e: Date
    if (p.end) {
      e = new Date(p.date)
      e.setHours(p.end.h, p.end.m, 0, 0)
      if (e <= s) e = addMinutes(s, type === 'task' ? 30 : 60)
    } else e = addMinutes(s, type === 'task' ? 30 : 60)
    out.start = s.toISOString()
    out.end = e.toISOString()
    if (type === 'task') out.due = ymd(p.date)
  } else if (type === 'task') {
    out.due = ymd(p.date)
  } else {
    out.allDay = true
    out.start = startOfDay(p.date).toISOString()
    out.end = startOfDay(p.date).toISOString()
  }
  return out
}
