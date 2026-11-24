import { addDays, startOfDay } from 'date-fns'
import type { Item, NotionColor, Section } from '../types'
import { COLORS } from '../types'
import { ymd } from './date'
import { instance, isRecurring, nextOccurrence, occurrences } from './recur'

export const isTimed = (it: Item) => !!it.start && !!it.end && !it.allDay

/** 해당 날짜 칸 안에서의 [시작분, 종료분] (자정 넘는 일정은 잘라서 표시) */
export function timedSegment(it: Item, day: Date): { startMin: number; endMin: number } | null {
  if (!isTimed(it)) return null
  const s = new Date(it.start!).getTime()
  const e = new Date(it.end!).getTime()
  const d0 = startOfDay(day).getTime()
  const d1 = addDays(startOfDay(day), 1).getTime()
  if (e <= d0 || s >= d1) return null
  const a = Math.max(s, d0)
  const b = Math.min(e, d1)
  const startMin = (a - d0) / 60000
  return { startMin, endMin: Math.max((b - d0) / 60000, startMin + 15) }
}

/** 종일 영역(또는 월간 칸)에 표시할 항목인지 */
export function isAllDayOn(it: Item, day: Date): boolean {
  const key = ymd(day)
  if (it.allDay && it.start) {
    const s = ymd(new Date(it.start))
    const e = it.end ? ymd(new Date(it.end)) : s
    return key >= s && key <= e
  }
  return it.type === 'task' && !isTimed(it) && it.due === key
}

export function dayItems(items: Item[], day: Date) {
  const allDay = items.filter((it) => isAllDayOn(it, day))
  const timed = items
    .filter((it) => timedSegment(it, day))
    .sort((a, b) => a.start!.localeCompare(b.start!))
  allDay.sort((a, b) => Number(a.type === 'task') - Number(b.type === 'task') || a.title.localeCompare(b.title))
  return { allDay, timed }
}

/** 할 일의 기준 날짜: 시간 블록이 있으면 그 날짜, 없으면 마감일 */
export const taskKey = (it: Item): string | undefined => (it.start ? ymd(new Date(it.start)) : it.due)

const prioRank = { high: 0, normal: 1, low: 2 }

export function sectionTasks(items: Item[], section: Section, now = new Date()): Item[] {
  const today = ymd(now)
  const tomorrow = ymd(addDays(now, 1))
  // 반복 할 일은 해당 회차로 바꿔서 보여준다 (오늘 → 오늘 회차, 그 외 → 다음 회차)
  const tasks = items
    .filter((it) => it.type === 'task')
    .flatMap((t) => {
      if (!isRecurring(t)) return [t]
      if (section.kind === 'done') return []
      if (section.kind === 'today') return occurrences(t, today, today).map((d) => instance(t, d))
      const next = nextOccurrence(t, section.kind === 'upcoming' ? tomorrow : today)
      return next ? [instance(t, next)] : []
    })
  let list: Item[]
  switch (section.kind) {
    case 'today':
      list = tasks.filter((t) => {
        const k = taskKey(t)
        return !!k && (k === today || (k < today && !t.done))
      })
      break
    case 'inbox':
      list = tasks.filter((t) => !t.done && !taskKey(t))
      break
    case 'upcoming':
      list = tasks.filter((t) => !t.done && (taskKey(t) ?? '') > today)
      break
    case 'done':
      return tasks.filter((t) => t.done).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    case 'tag':
      list = tasks.filter((t) => t.tags.includes(section.tag))
      break
  }
  return list.sort(
    (a, b) =>
      Number(!!a.done) - Number(!!b.done) ||
      (taskKey(a) ?? '9999').localeCompare(taskKey(b) ?? '9999') ||
      (a.start ?? '').localeCompare(b.start ?? '') ||
      prioRank[a.priority ?? 'normal'] - prioRank[b.priority ?? 'normal'] ||
      a.createdAt.localeCompare(b.createdAt),
  )
}

export function allTags(items: Item[]): { tag: string; count: number }[] {
  const m = new Map<string, number>()
  for (const it of items) for (const t of it.tags) m.set(t, (m.get(t) ?? 0) + 1)
  return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** 태그 이름 → 항상 같은 색 */
export function tagColor(tag: string): NotionColor {
  let h = 0
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) | 0
  return COLORS[Math.abs(h) % COLORS.length]
}

export const colorVars = (c: NotionColor) => ({
  background: `var(--c-${c}-bg)`,
  color: `var(--c-${c}-text)`,
})

/** 겹치는 일정들을 가로 칸으로 나눈다 */
export function layoutColumns(segs: { id: string; startMin: number; endMin: number }[]) {
  const sorted = [...segs].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  const out = new Map<string, { col: number; cols: number }>()
  let cluster: string[] = []
  let colsEnd: number[] = []
  let clusterEnd = -1
  const flush = () => {
    for (const id of cluster) out.get(id)!.cols = colsEnd.length
    cluster = []
    colsEnd = []
  }
  for (const s of sorted) {
    if (s.startMin >= clusterEnd) {
      flush()
      clusterEnd = -1
    }
    let col = colsEnd.findIndex((e) => e <= s.startMin)
    if (col < 0) {
      col = colsEnd.length
      colsEnd.push(s.endMin)
    } else colsEnd[col] = s.endMin
    out.set(s.id, { col, cols: 1 })
    cluster.push(s.id)
    clusterEnd = Math.max(clusterEnd, s.endMin)
  }
  flush()
  return out
}
