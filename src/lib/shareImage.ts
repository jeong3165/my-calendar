// 주간 일정 → 공유용 PNG 이미지 (캔버스에 직접 그림, 항상 밝은 테마)
import { addDays, format, isToday } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { Item } from '../types'
import { ymd } from './date'
import { dayItems, isTimed } from './items'
import { expandItems } from './recur'
import { holidayOn } from './holidays'

export type ShareOptions = {
  tasks: boolean // 할 일도
  weekend: boolean // 토·일도
  emptyDays: boolean // 일정 없는 날도 보이기
  subs: boolean // 구독 캘린더 일정도
  privateTag: string // 이 태그가 붙은 일정은…
  privateMode: 'mask' | 'hide' | 'show' // 제목 가리기 / 빼기 / 그대로
  title: string // 맨 위 제목 (비우면 자동)
}
export const SHARE_DEFAULT: ShareOptions = { tasks: false, weekend: true, emptyDays: true, subs: true, privateTag: '개인', privateMode: 'mask', title: '' }
const KEY = 'my-calendar.share'
export function loadShare(): ShareOptions {
  try {
    return { ...SHARE_DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...SHARE_DEFAULT }
  }
}
export function saveShare(o: ShareOptions) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o))
  } catch {
    /* ignore */
  }
}

// 밝은 테마 색 (index.css 와 같은 값)
const C = {
  bg: '#ffffff',
  card: '#f7f7f5',
  text: '#37352f',
  sub: '#787774',
  faint: '#9b9a97',
  line: 'rgba(55,53,47,0.12)',
  red: '#e03e3e',
  blue: '#2f6fd1',
  today: '#0b8a4c',
  holidayBg: '#fdf0ef',
  bars: { gray: '#9b9a97', brown: '#8c6a58', orange: '#d9730d', yellow: '#dfab01', green: '#0f7b6c', blue: '#2383e2', purple: '#9065b0', pink: '#c14c8a', red: '#e03e3e' } as Record<string, string>,
}
const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif'

type Row = { kind: 'allday' | 'timed' | 'task'; time: string; title: string; color: string; done?: boolean; cal?: string }

export function weekRows(all: Item[], weekStart: Date, o: ShareOptions) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).filter((d) => o.weekend || (d.getDay() !== 0 && d.getDay() !== 6))
  const expanded = expandItems(all, weekStart, addDays(weekStart, 7))
  return days.map((d) => {
    const { allDay, timed } = dayItems(expanded, d)
    const rows: Row[] = []
    const priv = (it: Item) => !!o.privateTag && it.tags.includes(o.privateTag)
    const keep = (it: Item) => (o.subs || !it.readonly || it.readonly.subId === 'dday') && !(priv(it) && o.privateMode === 'hide')
    const name = (it: Item) => (priv(it) && o.privateMode === 'mask' ? '개인 일정' : it.title || '(제목 없음)')
    for (const it of allDay)
      if (keep(it) && (it.type === 'event' || (o.tasks && it.type === 'task')))
        rows.push(it.type === 'task' ? { kind: 'task', time: '', title: name(it), color: C.bars[it.color] ?? C.faint, done: it.done } : { kind: 'allday', time: '종일', title: name(it), color: C.bars[it.color] ?? C.faint, cal: it.readonly?.subId === 'dday' ? undefined : it.readonly?.name })
    for (const it of timed)
      if (keep(it) && (it.type === 'event' || (o.tasks && it.type === 'task')) && isTimed(it))
        rows.push({ kind: it.type === 'task' ? 'task' : 'timed', time: `${format(new Date(it.start!), 'HH:mm')}–${format(new Date(it.end!), 'HH:mm')}`, title: name(it), color: C.bars[it.color] ?? C.faint, done: it.type === 'task' ? it.done : undefined, cal: it.readonly?.name })
    return { date: d, rows, hol: holidayOn(d) }
  })
}

/** 캔버스에 그려서 PNG Blob 으로 */
export async function renderWeekImage(all: Item[], weekStart: Date, o: ShareOptions): Promise<Blob> {
  try {
    await Promise.all([document.fonts.load(`600 30px ${FONT}`), document.fonts.load(`400 26px ${FONT}`)])
  } catch {
    /* 글꼴을 못 불러와도 기본 글꼴로 */
  }
  const days = weekRows(all, weekStart, o).filter((d) => o.emptyDays || d.rows.length)
  const W = 1080
  const P = 56 // 바깥 여백
  const HEAD = 170
  const DAY_HEAD = 58
  const ROW = 50
  const GAP = 22
  const heights = days.map((d) => DAY_HEAD + Math.max(1, d.rows.length) * ROW + 18)
  const H = HEAD + heights.reduce((a, b) => a + b + GAP, 0) + 70
  const scale = 2 // 선명하게
  const cv = document.createElement('canvas')
  cv.width = W * scale
  cv.height = H * scale
  const g = cv.getContext('2d')!
  g.scale(scale, scale)
  g.textBaseline = 'middle'

  const font = (size: number, weight = 400) => (g.font = `${weight} ${size}px ${FONT}`)
  const fit = (text: string, max: number) => {
    if (g.measureText(text).width <= max) return text
    let t = text
    while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1)
    return t + '…'
  }
  const round = (x: number, y: number, w: number, h: number, r: number, fill: string) => {
    g.fillStyle = fill
    g.beginPath()
    g.roundRect(x, y, w, h, r)
    g.fill()
  }

  // 배경 + 제목
  g.fillStyle = C.bg
  g.fillRect(0, 0, W, H)
  const end = addDays(weekStart, 6)
  font(44, 700)
  g.fillStyle = C.text
  g.fillText(o.title.trim() || weekTitle(weekStart), P, 72)
  font(26)
  g.fillStyle = C.sub
  g.fillText(`${format(weekStart, 'yyyy. M. d (EEE)', { locale: ko })} ~ ${format(end, 'M. d (EEE)', { locale: ko })}`, P, 124)

  let y = HEAD
  days.forEach((d, i) => {
    const h = heights[i]
    const dow = d.date.getDay()
    const red = d.hol?.off || dow === 0
    round(P, y, W - P * 2, h, 18, d.hol?.off ? C.holidayBg : C.card)
    // 날짜 머리
    font(30, 700)
    g.fillStyle = isToday(d.date) ? C.today : red ? C.red : dow === 6 ? C.blue : C.text
    const label = format(d.date, 'M/d (EEE)', { locale: ko })
    g.fillText(label, P + 28, y + 36)
    let hx = P + 28 + g.measureText(label).width + 14
    if (isToday(d.date)) {
      font(20, 600)
      round(hx, y + 22, g.measureText('오늘').width + 20, 28, 14, C.today)
      g.fillStyle = '#fff'
      g.fillText('오늘', hx + 10, y + 36)
      hx += g.measureText('오늘').width + 32
    }
    if (d.hol) {
      font(22, 600)
      g.fillStyle = d.hol.off ? C.red : C.faint
      g.fillText(fit(d.hol.names.join(' · '), W - P - hx - 40), hx, y + 37)
    }
    // 일정들
    let ry = y + DAY_HEAD + ROW / 2 - 4
    if (!d.rows.length) {
      font(24)
      g.fillStyle = C.faint
      g.fillText('일정 없음', P + 28, ry)
    }
    for (const r of d.rows) {
      const x0 = P + 28
      if (r.kind === 'task') {
        g.strokeStyle = r.done ? C.today : C.faint
        g.lineWidth = 2.5
        g.beginPath()
        g.roundRect(x0, ry - 12, 24, 24, 5)
        g.stroke()
        if (r.done) {
          g.beginPath()
          g.moveTo(x0 + 6, ry)
          g.lineTo(x0 + 11, ry + 6)
          g.lineTo(x0 + 19, ry - 6)
          g.stroke()
        }
      } else round(x0 + 8, ry - 15, 7, 30, 3.5, r.color)
      font(24, 600)
      g.fillStyle = C.sub
      const tx = x0 + 40
      g.fillText(r.time, tx, ry)
      const titleX = tx + (r.time ? 180 : 0)
      font(26, r.kind === 'task' ? 400 : 500)
      g.fillStyle = r.done ? C.faint : C.text
      const calW = r.cal ? (font(20), g.measureText(r.cal).width + 26) : 0
      font(26, r.kind === 'task' ? 400 : 500)
      const t = fit(r.title, W - P - 40 - titleX - calW)
      g.fillText(t, titleX, ry)
      if (r.done) {
        const w = g.measureText(t).width
        g.fillRect(titleX, ry + 1, w, 2)
      }
      if (r.cal) {
        font(20)
        const cw = g.measureText(r.cal).width
        const cx = W - P - 28 - cw - 16
        round(cx, ry - 15, cw + 16, 30, 8, 'rgba(55,53,47,0.07)')
        g.fillStyle = C.sub
        g.fillText(r.cal, cx + 8, ry + 1)
      }
      ry += ROW
    }
    y += h + GAP
  })

  font(20)
  g.fillStyle = C.faint
  g.fillText('내 캘린더', P, H - 40)

  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('이미지를 만들지 못했어요.'))), 'image/png'))
}

export const weekFileName = (weekStart: Date) => `week-${ymd(weekStart)}.png`

/** 한국식 주차: 그 주 목요일이 속한 달의 몇째 주 (예: 11/23~29 → 11월 4주차) */
export function weekTitle(weekStart: Date) {
  const thu = addDays(weekStart, 3)
  return `${format(thu, 'M월')} ${Math.ceil(thu.getDate() / 7)}주차 일정`
}
