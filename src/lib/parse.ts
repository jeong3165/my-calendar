import { addDays, addMinutes, addMonths, getDaysInMonth, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import type { Item, Priority, Repeat } from '../types'
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
  repeat?: Repeat
  project?: string // '@프로젝트' 로 적은 이름
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

/** opts.noDate: 날짜·반복 단어(오늘, 매주 …)는 해석하지 않고 제목에 그대로 둔다 (템플릿용) */
export function parseQuick(input: string, now = new Date(), opts: { noDate?: boolean } = {}): Parsed {
  let s = ` ${input} `
  const tags: string[] = []
  let priority: Priority | undefined
  let date: Date | undefined
  const today = startOfDay(now)

  let project: string | undefined
  s = s.replace(/(^|\s)@([^\s#!@]+)/, (_, sp: string, p: string) => {
    project = p
    return sp
  })
  s = s.replace(/#([^\s#!]+)/g, (_, t: string) => {
    if (!tags.includes(t)) tags.push(t)
    return ' '
  })
  s = s.replace(/(^|\s)!(높음|높|상|high|h|보통|중|normal|n|낮음|낮|하|low|l|[123])(?=\s)/gi, (_, sp: string, p: string) => {
    priority = PRIO[p.toLowerCase()]
    return sp
  })

  // ── 반복 ──
  const rep = opts.noDate ? null : parseRepeat(s, today)
  let repeatDate: Date | undefined
  let repeat: Repeat | undefined
  if (rep) {
    s = rep.rest
    repeat = rep.repeat
    repeatDate = rep.date
  }

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
    [/(어제)/, () => addDays(today, -1)],
    [/(그저께|그제)/, () => addDays(today, -2)],
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
  for (const [re, fn] of opts.noDate ? [] : rules) {
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
  if (!date && repeatDate) date = repeatDate
  if (start && !date) date = today
  if (repeat && !date) date = today

  return { title: s.replace(/\s+/g, ' ').trim(), date, start, end, tags, priority, repeat, project }
}

/** 해석 결과 → Item 필드 */
export function parsedToItem(p: Parsed, type: Item['type']): Partial<Item> {
  const out: Partial<Item> = { title: p.title, tags: p.tags }
  if (p.repeat) out.repeat = p.repeat
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

/* ───────── 반복 표현 ─────────
 * 매일 / 3일마다 / 평일 / 주말 / 매주 월요일 / 매주 월,수 / 격주 금요일 / 2주마다 화
 * 매월 25일 / 매달 마지막 금요일 / 매월 첫째 주 월요일 / 매년 3월 1일
 * + "12월 31일까지", "10회"
 */
const WDS = '월화수목금토일'
const NTHS: Record<string, number> = { 첫째: 1, 첫: 1, 둘째: 2, 셋째: 3, 넷째: 4, 마지막: 5 }

function parseRepeat(text: string, today: Date): { repeat: Repeat; date?: Date; rest: string } | null {
  let s = text
  let repeat: Repeat | undefined
  let date: Date | undefined
  const cut = (m: RegExpMatchArray, extra = 0) => {
    s = s.slice(0, m.index!) + ' ' + s.slice(m.index! + m[0].length + extra)
  }
  const nextWeekday = (days: number[]) => {
    for (let i = 0; i < 7; i++) {
      const d = addDays(today, i)
      if (days.includes((d.getDay() + 6) % 7)) return d
    }
    return today
  }

  let m: RegExpMatchArray | null
  if ((m = s.match(/(매주|격주|(\d+)\s*주\s*마다)/))) {
    const interval = m[1] === '격주' ? 2 : m[2] ? Number(m[2]) : 1
    // 뒤따르는 요일들 읽기: "월요일", "월, 수", "월·수·금"
    let i = m.index! + m[0].length
    const days: number[] = []
    for (;;) {
      const sep = s.slice(i).match(/^[\s,·/]*/)![0].length
      const ch = s[i + sep]
      const after = s.slice(i + sep + 1)
      if (ch && WDS.includes(ch) && (/^요일/.test(after) || /^([\s,·/]|$)/.test(after) || WDS.includes(after[0] ?? ''))) {
        days.push(WDS.indexOf(ch))
        i += sep + 1 + (/^요일/.test(after) ? 2 : 0)
        if (s.slice(i).startsWith('마다')) i += 2
      } else break
    }
    const extra = i - (m.index! + m[0].length)
    cut(m, extra)
    repeat = { freq: 'weekly', interval, byDay: days.length ? [...new Set(days)].sort() : undefined }
    if (days.length) date = nextWeekday(days)
  } else if ((m = s.match(/평일(?:마다)?|주중/))) {
    cut(m)
    repeat = { freq: 'weekly', interval: 1, byDay: [0, 1, 2, 3, 4] }
    date = nextWeekday([0, 1, 2, 3, 4])
  } else if ((m = s.match(/주말(?:마다)?/))) {
    cut(m)
    repeat = { freq: 'weekly', interval: 1, byDay: [5, 6] }
    date = nextWeekday([5, 6])
  } else if ((m = s.match(/(매일|날마다|(\d+)\s*일\s*마다)/))) {
    cut(m)
    repeat = { freq: 'daily', interval: m[2] ? Number(m[2]) : 1 }
  } else if ((m = s.match(/(매월|매달|(\d+)\s*개월\s*마다)\s*(첫째|첫|둘째|셋째|넷째|마지막)\s*주?\s*([월화수목금토일])요일/))) {
    cut(m)
    const nth = NTHS[m[3]]
    repeat = { freq: 'monthly', interval: m[2] ? Number(m[2]) : 1, monthly: 'nth', nth: nth === 5 ? -1 : nth }
    const wd = WDS.indexOf(m[4])
    for (let k = 0; k < 3 && !date; k++) {
      const mon = addMonths(startOfMonth(today), k)
      let d: Date
      if (nth === 5) {
        d = new Date(mon.getFullYear(), mon.getMonth(), getDaysInMonth(mon))
        while ((d.getDay() + 6) % 7 !== wd) d = addDays(d, -1)
      } else {
        d = new Date(mon)
        while ((d.getDay() + 6) % 7 !== wd) d = addDays(d, 1)
        d = addDays(d, (nth - 1) * 7)
      }
      if (d >= today && d.getMonth() === mon.getMonth()) date = d
    }
  } else if ((m = s.match(/(매월|매달|(\d+)\s*개월\s*마다)\s*(?:(\d{1,2})일)?/))) {
    cut(m)
    repeat = { freq: 'monthly', interval: m[2] ? Number(m[2]) : 1, monthly: 'day' }
    if (m[3]) {
      const day = Number(m[3])
      let d = new Date(today.getFullYear(), today.getMonth(), day)
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, day)
      date = d
    }
  } else if ((m = s.match(/매년\s*(?:(\d{1,2})월\s*(\d{1,2})일)?/))) {
    cut(m)
    repeat = { freq: 'yearly', interval: 1 }
    if (m[1]) {
      let d = new Date(today.getFullYear(), Number(m[1]) - 1, Number(m[2]))
      if (d < today) d = new Date(today.getFullYear() + 1, Number(m[1]) - 1, Number(m[2]))
      date = d
    }
  }
  if (!repeat) return null

  // 끝: "12월 31일까지" / "2027-01-31까지" / "10회", "10번"
  if ((m = s.match(/(?:(\d{4})[-./])?(\d{1,2})(?:월\s*|[-./])(\d{1,2})일?\s*까지/))) {
    const y = m[1] ? Number(m[1]) : today.getFullYear()
    let u = new Date(y, Number(m[2]) - 1, Number(m[3]))
    if (!m[1] && u < today) u = new Date(y + 1, Number(m[2]) - 1, Number(m[3]))
    repeat.until = `${u.getFullYear()}-${String(u.getMonth() + 1).padStart(2, '0')}-${String(u.getDate()).padStart(2, '0')}`
    cut(m)
  } else if ((m = s.match(/(\d{1,3})\s*(?:회|번)(?![가-힣])/))) {
    repeat.count = Number(m[1])
    cut(m)
  }
  return { repeat, date, rest: s }
}
