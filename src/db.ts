import Dexie, { type EntityTable } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import type { Item } from './types'
import { ymd } from './lib/date'

export const db = new Dexie('my-notion-calendar') as Dexie & {
  items: EntityTable<Item, 'id'>
}

db.version(1).stores({
  items: 'id, type, start, due, updatedAt',
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
  await db.items.add(item)
  return item
}

/** undefined 값을 넘기면 해당 필드는 삭제된다 (Dexie 동작). */
export function updateItem(id: string, patch: Partial<Item>) {
  return db.items.update(id, { ...patch, updatedAt: new Date().toISOString() })
}

export function deleteItem(id: string) {
  return db.items.delete(id)
}

export function useItems(): Item[] {
  return useLiveQuery(() => db.items.toArray(), []) ?? EMPTY
}
const EMPTY: Item[] = []

/* ───────── 백업: 내보내기 / 가져오기 ───────── */
export async function exportJSON() {
  const items = await db.items.toArray()
  const blob = new Blob([JSON.stringify({ app: 'my-notion-calendar', version: 1, exportedAt: new Date().toISOString(), items }, null, 2)], {
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
  return items.length
}
