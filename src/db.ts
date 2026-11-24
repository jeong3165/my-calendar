import Dexie, { type EntityTable } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Item, Journal } from './types'
import { ymd } from './lib/date'
import { loadNotify } from './lib/notify'

/** 삭제 기록: 다른 기기와 동기화할 때 지운 항목이 되살아나지 않게 한다 */
export type Tombstone = { id: string; deletedAt: string }

export const db = new Dexie('my-notion-calendar') as Dexie & {
  items: EntityTable<Item, 'id'>
  tombstones: EntityTable<Tombstone, 'id'>
  journal: EntityTable<Journal, 'date'>
  subcache: EntityTable<SubCache, 'id'>
}

/** 구독 캘린더를 마지막으로 받아 온 결과 (오프라인에서도 보이도록) */
export type SubCache = { id: string; fetchedAt: string; method: 'direct' | 'github'; items: Item[] }

db.version(1).stores({
  items: 'id, type, start, due, updatedAt',
})
db.version(2).stores({
  items: 'id, type, start, due, updatedAt',
  tombstones: 'id, deletedAt',
})
db.version(3).stores({
  items: 'id, type, start, due, updatedAt',
  tombstones: 'id, deletedAt',
  journal: 'date, updatedAt',
})
db.version(4).stores({
  items: 'id, type, start, due, updatedAt',
  tombstones: 'id, deletedAt',
  journal: 'date, updatedAt',
  subcache: 'id',
})

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

export async function createItem(patch: Partial<Item> & Pick<Item, 'type'>): Promise<Item> {
  const now = new Date().toISOString()
  const base: Item = {
    id: uid(),
    type: patch.type,
    title: '',
    tags: [],
    color: patch.type === 'event' ? 'blue' : 'gray',
    createdAt: now,
    updatedAt: now,
    ...(patch.type === 'task' ? { done: false, priority: 'normal' as const } : {}),
  }
  const item: Item = { ...base, ...patch }
  // 새 일정에는 설정의 기본 알림을 붙인다 (할 일은 직접 켤 때만)
  if (item.type === 'event' && item.remind === undefined && item.start) {
    const d = loadNotify()
    const r = item.allDay ? d.defaultAllDay : d.defaultTimed
    if (r.length) item.remind = [...r]
  }
  await db.items.add(item)
  return item
}

/** undefined 값을 넘기면 해당 필드는 삭제된다 (Dexie 동작). */
export function updateItem(id: string, patch: Partial<Item>) {
  const now = new Date().toISOString()
  // 완료 시각 기록 (하루 정리에서 '오늘 끝낸 일'을 알기 위해)
  const extra: Partial<Item> = 'done' in patch && !('doneAt' in patch) ? { doneAt: patch.done ? now : undefined } : {}
  return db.items.update(id, { ...patch, ...extra, updatedAt: now })
}

/* ───────── 하루 기록 ───────── */
export function useJournal(date: string): Journal | undefined {
  return useLiveQuery(() => db.journal.get(date), [date])
}
export function useJournals(from: string, to: string): Journal[] {
  return useLiveQuery(() => db.journal.where('date').between(from, to, true, true).toArray(), [from, to]) ?? EMPTY_J
}
const EMPTY_J: Journal[] = []

export function saveJournal(date: string, patch: Partial<Journal>) {
  // 읽고-쓰기를 한 트랜잭션으로 묶어 연달아 저장해도 서로 덮어쓰지 않게 한다
  return db.transaction('rw', db.journal, async () => {
    const cur = await db.journal.get(date)
    await db.journal.put({ ...cur, ...patch, date, updatedAt: new Date().toISOString() })
  })
}

export function deleteItem(id: string) {
  return db.transaction('rw', db.items, db.tombstones, async () => {
    await db.items.delete(id)
    await db.tombstones.put({ id, deletedAt: new Date().toISOString() })
  })
}

export function useItems(): Item[] {
  return useLiveQuery(() => db.items.toArray(), []) ?? EMPTY
}
const EMPTY: Item[] = []

/* ───────── 백업: 내보내기 / 가져오기 ───────── */
export async function exportJSON() {
  const [items, journal] = await Promise.all([db.items.toArray(), db.journal.toArray()])
  const blob = new Blob([JSON.stringify({ app: 'my-notion-calendar', version: 1, exportedAt: new Date().toISOString(), items, journal }, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `calendar-backup-${ymd(new Date())}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function importJSON(file: File): Promise<number> {
  const data = JSON.parse(await file.text())
  const raw: unknown[] = Array.isArray(data) ? data : data?.items
  if (!Array.isArray(raw)) throw new Error('올바른 백업 파일이 아닙니다.')
  const items = raw.filter(
    (x): x is Item =>
      !!x && typeof x === 'object' && typeof (x as Item).id === 'string' && ((x as Item).type === 'event' || (x as Item).type === 'task'),
  )
  const now = new Date().toISOString()
  await db.items.bulkPut(
    items.map((it) => ({
      ...it,
      title: it.title ?? '',
      tags: Array.isArray(it.tags) ? it.tags : [],
      color: it.color ?? 'gray',
      createdAt: it.createdAt ?? now,
      updatedAt: it.updatedAt ?? now,
    })),
  )
  const journal: Journal[] = Array.isArray(data?.journal) ? data.journal.filter((j: Journal) => j && typeof j.date === 'string') : []
  if (journal.length) await db.journal.bulkPut(journal.map((j) => ({ ...j, updatedAt: j.updatedAt ?? now })))
  return items.length
}
