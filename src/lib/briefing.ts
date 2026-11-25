// 아침 브리핑: 오늘 일정·할 일·마감을 한눈에 (설정과 내용 계산)
import { addDays, format, startOfDay } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { Item } from '../types'
import { parseYmd, ymd } from './date'
import { dayItems, isTimed, taskKey } from './items'
import { expandItems, instance, isRecurring, occurrences } from './recur'

/* ───────── 설정 (기기마다) ───────── */
export type BriefingSettings = {
  enabled: boolean
  time: string // HH:MM
  weekdaysOnly: boolean
  ai: boolean // Claude 한마디 (API 키 필요)
  city: string // AI 한마디에 날씨를 넣을 도시 (비우면 날씨 없음)
}
const KEY = 'my-calendar.briefing'
const DEFAULTS: BriefingSettings = { enabled: false, time: '08:30', weekdaysOnly: false, ai: false, city: '' }
export function loadBriefing(): BriefingSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}
export function saveBriefing(s: BriefingSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/* ───────── 오늘 이미 보여 줬는지 ───────── */
const LAST = 'my-calendar.briefing-last'
export function shownToday(now = new Date()) {
  try {
    return localStorage.getItem(LAST) === ymd(now)
  } catch {
    return false
  }
}
export function markShown(now = new Date()) {
  try {
    localStorage.setItem(LAST, ymd(now))
  } catch {
    /* ignore */
  }
}

const CUTOFF = 15 * 60 // 오후 3시가 지나서 처음 열면 그날 브리핑은 건너뜀

/** 지금 브리핑을 띄울 때인지 (정한 시각 이후 ~ 오후 3시, 하루 한 번) */
export function isDue(s: BriefingSettings, now = new Date()) {
  if (!s.enabled || shownToday(now)) return false
  const dow = now.getDay()
  if (s.weekdaysOnly && (dow === 0 || dow === 6)) return false
  const [h, m] = s.time.split(':').map(Number)
  const min = now.getHours() * 60 + now.getMinutes()
  return min >= h * 60 + m && min < Math.max(CUTOFF, h * 60 + m + 60)
}

/* ───────── 브리핑 내용 ───────── */
export type Briefing = {
  date: string // YYYY-MM-DD
  label: string // 11월 25일 수요일
  events: Item[] // 오늘 일정 (종일 먼저, 그다음 시간순)
  dueToday: Item[] // 오늘 마감 할 일 (반복 아닌 것)
  overdue: Item[] // 지난 마감인데 안 끝난 할 일
  doing: Item[] // 진행 중
  habits: Item[] // 오늘 할 반복 할 일
  soon: Item[] // 3일 안에 마감 (내일~모레)
  projects: Item[] // 7일 안에 마감인 프로젝트
  nextEvent?: Item // 지금 이후 가장 가까운 시간 일정
}

export function buildBriefing(all: Item[], now = new Date()): Briefing {
  const today = ymd(now)
  const d0 = startOfDay(now)
  const own = all.filter((x) => x.type !== 'template')
  const expanded = expandItems(own, d0, addDays(d0, 1))
  const { allDay, timed } = dayItems(expanded, d0)
  const events = [...allDay.filter((x) => x.type === 'event'), ...timed.filter((x) => x.type === 'event' || (x.type === 'task' && !x.done))]

  const tasks = own.filter((x) => x.type === 'task' && !isRecurring(x) && !x.done)
  const dueToday = tasks.filter((t) => taskKey(t) === today && !isTimed(t))
  const overdue = tasks.filter((t) => (taskKey(t) ?? '9999') < today).sort((a, b) => (taskKey(a) ?? '').localeCompare(taskKey(b) ?? ''))
  const doing = tasks.filter((t) => t.doing && !dueToday.includes(t) && !overdue.includes(t))
  const habits = own
    .filter((x) => x.type === 'task' && isRecurring(x))
    .flatMap((t) => occurrences(t, today, today).map((d) => instance(t, d)))
    .filter((t) => !t.done && !isTimed(t))
  const until = ymd(addDays(d0, 3))
  const soon = tasks.filter((t) => {
    const k = taskKey(t) ?? ''
    return k > today && k <= until
  }).sort((a, b) => (taskKey(a) ?? '').localeCompare(taskKey(b) ?? ''))
  const week = ymd(addDays(d0, 7))
  const projects = own.filter((p) => p.type === 'project' && !p.done && p.due && p.due >= today && p.due <= week).sort((a, b) => a.due!.localeCompare(b.due!))
  const nextEvent = timed.find((x) => x.type === 'event' && new Date(x.start!) > now)

  return { date: today, label: format(now, 'M월 d일 EEEE', { locale: ko }), events, dueToday, overdue, doing, habits, soon, projects, nextEvent }
}

export const taskCount = (b: Briefing) => b.dueToday.length + b.overdue.length + b.habits.length
export const isEmpty = (b: Briefing) => !b.events.length && !taskCount(b) && !b.doing.length && !b.soon.length && !b.projects.length

const hm = (iso: string) => format(new Date(iso), 'HH:mm')
export const timeLabel = (it: Item) => (isTimed(it) ? `${hm(it.start!)}–${hm(it.end!)}` : it.allDay ? '종일' : '')
export const dueLabel = (it: Item, now = new Date()) => {
  const k = taskKey(it)
  if (!k) return ''
  const diff = Math.round((parseYmd(k).getTime() - startOfDay(now).getTime()) / 86400000)
  return diff === 0 ? '오늘' : diff === 1 ? '내일' : diff === 2 ? '모레' : diff < 0 ? `${-diff}일 지남` : format(parseYmd(k), 'M/d(EEE)', { locale: ko })
}

/** 시스템 알림 한 줄 요약 */
export function summaryLine(b: Briefing) {
  if (isEmpty(b)) return '오늘은 일정과 할 일이 없어요. 여유로운 하루 보내세요!'
  const parts: string[] = []
  if (b.events.length) parts.push(`일정 ${b.events.length}개${b.nextEvent ? ` (첫 일정 ${hm(b.nextEvent.start!)} ${b.nextEvent.title || '제목 없음'})` : ''}`)
  const tc = b.dueToday.length + b.habits.length
  if (tc) parts.push(`할 일 ${tc}개`)
  if (b.overdue.length) parts.push(`밀린 할 일 ${b.overdue.length}개`)
  if (b.soon.length) parts.push(`곧 마감 ${b.soon.length}개`)
  return parts.join(' · ')
}

/** AI 한마디용 요약 자료 */
export function briefingForAI(b: Briefing, projectName: (id?: string) => string | undefined) {
  const t = (it: Item) => ({ title: it.title || '제목 없음', ...(timeLabel(it) ? { time: timeLabel(it) } : {}), ...(it.priority === 'high' ? { priority: 'high' } : {}), ...(projectName(it.projectId) ? { project: projectName(it.projectId) } : {}), ...(it.readonly ? { calendar: it.readonly.name } : {}) })
  return {
    today: b.label,
    events: b.events.map(t),
    due_today: b.dueToday.map(t),
    overdue: b.overdue.map((x) => ({ ...t(x), due: dueLabel(x) })),
    in_progress: b.doing.map(t),
    habits: b.habits.map((x) => x.title),
    due_soon: b.soon.map((x) => ({ ...t(x), due: dueLabel(x) })),
    projects_due_this_week: b.projects.map((p) => ({ title: p.title, due: p.due })),
  }
}

/* ───────── AI 한마디 캐시 (하루 한 번만 요금) ───────── */
const AI_KEY = 'my-calendar.briefing-ai'
export function loadAINote(date: string): string | null {
  try {
    const v = JSON.parse(localStorage.getItem(AI_KEY) ?? 'null')
    return v?.date === date ? v.text : null
  } catch {
    return null
  }
}
export function saveAINote(date: string, text: string) {
  try {
    localStorage.setItem(AI_KEY, JSON.stringify({ date, text }))
  } catch {
    /* ignore */
  }
}
