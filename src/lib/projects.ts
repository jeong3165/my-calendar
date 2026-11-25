import { useMemo } from 'react'
import { createItem, db, deleteItem, updateItem, useItems } from '../db'
import type { FocusSession, Item, Subtask } from '../types'
import { ymd } from './date'
import { isRecurring } from './recur'

export const PROJECT_ICONS = ['📁', '🚀', '🏠', '📚', '💼', '🎯', '✈️', '💪', '🎨', '🧪', '💰', '🎉']

/** 프로젝트 목록 (진행 중 먼저, 마감 가까운 순) */
export function useProjects(): Item[] {
  const items = useItems()
  return useMemo(
    () =>
      items
        .filter((x) => x.type === 'project')
        .sort((a, b) => Number(!!a.done) - Number(!!b.done) || (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt.localeCompare(b.createdAt)),
    [items],
  )
}

export type ProjectStats = {
  tasks: Item[]
  events: Item[]
  done: number
  total: number
  pct: number // 0~1
  overdue: number
  focusMinutes: number
}

export function projectStats(p: Item, items: Item[], sessions: FocusSession[] = []): ProjectStats {
  const tasks = items.filter((x) => x.type === 'task' && x.projectId === p.id)
  const events = items.filter((x) => x.type === 'event' && x.projectId === p.id)
  const today = ymd(new Date())
  // 반복 할 일은 진행률 계산에서 뺀다 (끝이 없으니까)
  const counted = tasks.filter((t) => !isRecurring(t))
  const done = counted.filter((t) => t.done).length
  const ids = new Set(tasks.map((t) => t.id))
  return {
    tasks,
    events,
    done,
    total: counted.length,
    pct: counted.length ? done / counted.length : 0,
    overdue: counted.filter((t) => !t.done && (t.start ? ymd(new Date(t.start)) : t.due ?? '9999') < today).length,
    focusMinutes: sessions.filter((x) => x.itemId && ids.has(x.itemId.split('::')[0])).reduce((s, x) => s + x.minutes, 0),
  }
}

export async function createProject(title = '') {
  return createItem({ type: 'project', title, icon: PROJECT_ICONS[Math.floor(Math.random() * PROJECT_ICONS.length)], color: 'blue' })
}

/** 프로젝트만 지우고, 안의 할 일·일정은 남긴다 */
export async function deleteProject(id: string) {
  const inside = await db.items.filter((x) => x.projectId === id).toArray()
  for (const x of inside) await updateItem(x.id, { projectId: undefined })
  await deleteItem(id)
}

/** "@이사" → 이름이 그렇게 시작하는(공백 무시) 진행 중 프로젝트 */
export function matchProject(query: string | undefined, projects: Item[]): Item | undefined {
  if (!query) return undefined
  const q = query.replace(/\s+/g, '').toLowerCase()
  const active = projects.filter((p) => !p.done)
  const norm = (p: Item) => p.title.replace(/\s+/g, '').toLowerCase()
  return active.find((p) => norm(p) === q) ?? active.find((p) => norm(p).startsWith(q)) ?? active.find((p) => norm(p).includes(q))
}

/* ───────── 하위 할 일 ───────── */
const sid = () => Math.random().toString(36).slice(2, 9)
export const newSubtask = (title = ''): Subtask => ({ id: sid(), title, done: false })
export const subtaskProgress = (it: Item) => (it.subtasks?.length ? { done: it.subtasks.filter((s) => s.done).length, total: it.subtasks.length } : null)

/** 빠른 입력의 "@프로젝트"를 실제 프로젝트에 연결. 못 찾으면 제목에 그대로 남긴다 */
export async function withProject<T extends { title?: string }>(patch: T, query?: string): Promise<T & { projectId?: string }> {
  if (!query) return patch
  const projects = (await db.items.toArray()).filter((x) => x.type === 'project')
  const hit = matchProject(query, projects)
  return hit ? { ...patch, projectId: hit.id } : { ...patch, title: `${patch.title ?? ''} @${query}`.trim() }
}
