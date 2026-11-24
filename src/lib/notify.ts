import { addDays, format, isToday, isTomorrow } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { Item } from '../types'
import { parseYmd } from './date'

/* ───────── 설정 ───────── */
export type NotifySettings = { enabled: boolean; defaultTimed: number[]; defaultAllDay: number[] }
const KEY = 'my-calendar.notify-settings'
const DEFAULTS: NotifySettings = { enabled: false, defaultTimed: [10], defaultAllDay: [] }

export function loadNotify(): NotifySettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}
export function saveNotify(s: NotifySettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/* ───────── 알림 시점 ───────── */
// 시간 있는 항목: 시작 몇 분 전
export const REMIND_TIMED: [number, string][] = [
  [0, '시작할 때'],
  [5, '5분 전'],
  [10, '10분 전'],
  [15, '15분 전'],
  [30, '30분 전'],
  [60, '1시간 전'],
  [120, '2시간 전'],
  [1440, '하루 전'],
]
// 종일/마감일 항목: 그날 0시 기준 (음수 = 당일 그 시각)
export const REMIND_ALLDAY: [number, string][] = [
  [-540, '당일 오전 9시'],
  [-480, '당일 오전 8시'],
  [900, '전날 오전 9시'],
  [2340, '2일 전 오전 9시'],
]

export const hasTime = (it: Item) => !!it.start && !it.allDay

export function remindLabel(m: number, timed: boolean) {
  const list = timed ? REMIND_TIMED : REMIND_ALLDAY
  const hit = list.find(([v]) => v === m)
  if (hit) return hit[1]
  if (timed) return m >= 60 && m % 60 === 0 ? `${m / 60}시간 전` : `${m}분 전`
  return m < 0 ? `당일 ${Math.floor(-m / 60)}시` : `${m}분 전`
}

/** 항목의 기준 시각 (시간 있으면 시작, 없으면 그날 0시) */
export function anchor(it: Item): Date | null {
  if (it.start) return it.allDay ? parseYmd(format(new Date(it.start), 'yyyy-MM-dd')) : new Date(it.start)
  if (it.due) return parseYmd(it.due)
  return null
}

export function remindAt(it: Item, m: number): Date | null {
  const a = anchor(it)
  return a ? new Date(a.getTime() - m * 60000) : null
}

/** 알림 본문: "10분 후 · 15:00–16:00" */
export function notifyBody(it: Item, now = new Date()): string {
  const a = anchor(it)
  if (!a) return ''
  const day = isToday(a) ? '오늘' : isTomorrow(a) ? '내일' : format(a, 'M월 d일 (EEE)', { locale: ko })
  if (!hasTime(it)) return `${day} · ${it.type === 'task' ? '마감' : '종일'}`
  const mins = Math.round((a.getTime() - now.getTime()) / 60000)
  const when = mins <= 0 ? '지금 시작' : mins < 60 ? `${mins}분 후 시작` : mins < 1440 ? `${Math.round(mins / 60)}시간 후 시작` : `${day} 시작`
  const end = it.end ? `–${format(new Date(it.end), 'HH:mm')}` : ''
  return `${when} · ${day} ${format(a, 'HH:mm')}${end}`
}

/* ───────── 이미 보낸 알림 기록 (기기별) ───────── */
const FIRED = 'my-calendar.fired'
export function loadFired(): Record<string, number> {
  try {
    const all: Record<string, number> = JSON.parse(localStorage.getItem(FIRED) ?? '{}')
    const cutoff = addDays(new Date(), -3).getTime()
    for (const [k, t] of Object.entries(all)) if (t < cutoff) delete all[k]
    return all
  } catch {
    return {}
  }
}
export function saveFired(f: Record<string, number>) {
  try {
    localStorage.setItem(FIRED, JSON.stringify(f))
  } catch {
    /* ignore */
  }
}

export const notifySupported = () => typeof window !== 'undefined' && 'Notification' in window
export const permission = (): NotificationPermission | 'unsupported' => (notifySupported() ? Notification.permission : 'unsupported')

/** 시스템 알림 띄우기 (서비스 워커가 있으면 그쪽으로 — 안드로이드 크롬은 이 방법만 됨) */
export async function showSystemNotification(title: string, body: string, data: { id: string; date?: string }, tag: string) {
  if (permission() !== 'granted') return false
  const opts: NotificationOptions = { body, tag, icon: './icon-192.png', badge: './icon-192.png', data }
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined
    if (reg?.active) {
      await reg.showNotification(title, opts)
      return true
    }
    const n = new Notification(title, opts)
    n.onclick = () => {
      window.focus()
      window.dispatchEvent(new CustomEvent('open-item', { detail: data }))
      n.close()
    }
    return true
  } catch {
    return false
  }
}
