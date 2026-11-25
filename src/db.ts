import Dexie, { type EntityTable } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import type { FocusSession, Item, Journal } from './types'
import { ymd } from './lib/date'
import { loadNotify } from './lib/notify'

/** 삭제 기록: 다른 기기와 동기화할 때 지운 항목이 되살아나지 않게 한다 */
export type Tombstone = {
  id: string
  deletedAt: string
  /** 휴지통 사본 (30일 보관). null = 휴지통에서 영구 삭제함, 없음 = 휴지통에 안 넣은 삭제 */
  item?: Item | null
}

export const db = new Dexie('my-notion-calendar') as Dexie & {
  items: EntityTable<Item, 'id'>
  tombstones: EntityTable<Tombstone, 'id'>
  journal: EntityTable<Journal, 'date'>
  subcache: EntityTable<SubCache, 'id'>
  sessions: EntityTable<FocusSession, 'id'>
  chats: EntityTable<Chat, 'id'>
}

/** AI 채팅 대화 (이 기기에만 저장, 동기화하지 않음) */
export type ChatAction = { kind: 'add' | 'done'; summary: string; undo: { created: string[]; before: Item[] }; undone?: boolean }
export type Chat = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  /** Claude API 에 그대로 다시 보내는 대화 기록 (BetaMessageParam[]) */
  messages: unknown[]
  /** 채팅에서 바꾼 캘린더 내용 (tool_use id 별) — 되돌리기용 */
  actions: Record<string, ChatAction>
  /** 쓴 토큰 (대략적인 비용 안내용) */
  usage?: { input: number; output: number; cacheRead: number; searches: number }
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
db.version(5).stores({
  items: 'id, type, start, due, updatedAt',
  tombstones: 'id, deletedAt',
  journal: 'date, updatedAt',
  subcache: 'id',
  sessions: 'id, date, itemId',
})
db.version(6).stores({
  items: 'id, type, start, due, updatedAt',
  tombstones: 'id, deletedAt',
  journal: 'date, updatedAt',
  subcache: 'id',
  sessions: 'id, date, itemId',
  chats: 'id, updatedAt',
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

/** 지우기 — 기본은 휴지통으로 (빈 초안·되돌리기·체험 데이터는 trash: false) */
export function deleteItem(id: string, opts: { trash?: boolean } = {}) {
  return db.transaction('rw', db.items, db.tombstones, async () => {
    const it = await db.items.get(id)
    await db.items.delete(id)
    await db.tombstones.put({ id, deletedAt: new Date().toISOString(), ...(opts.trash !== false && it ? { item: it } : {}) })
  })
}

/* ───────── 휴지통 ───────── */
export const TRASH_DAYS = 30
export type TrashEntry = { id: string; deletedAt: string; item: Item }
const EMPTY_T: TrashEntry[] = []
export function useTrash(): TrashEntry[] {
  return (
    useLiveQuery(async () => {
      const cutoff = new Date(Date.now() - TRASH_DAYS * 86400000).toISOString()
      return (await db.tombstones.toArray())
        .filter((t): t is TrashEntry => !!t.item && t.deletedAt >= cutoff)
        .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt))
    }, []) ?? EMPTY_T
  )
}
/** 되살리기: 지금 고친 것으로 저장 → 동기화하면 다른 기기에서도 살아남 */
export async function restoreItem(id: string) {
  await db.transaction('rw', db.items, db.tombstones, async () => {
    const t = await db.tombstones.get(id)
    if (!t?.item) return
    await db.items.put({ ...t.item, updatedAt: new Date().toISOString() })
    await db.tombstones.delete(id)
  })
}
/** 휴지통에서 영구 삭제 (삭제 기록은 남겨 다른 기기에서 되살아나지 않게) */
export async function purgeTrash(ids?: string[]) {
  const all = await db.tombstones.toArray()
  const target = all.filter((t) => t.item && (!ids || ids.includes(t.id)))
  await db.tombstones.bulkPut(target.map((t) => ({ ...t, item: null })))
}

export function useItems(): Item[] {
  return useLiveQuery(() => db.items.toArray(), []) ?? EMPTY
}
const EMPTY: Item[] = []

/* ───────── 백업: 내보내기 / 가져오기 ───────── */
export async function exportJSON() {
  const [items, journal, sessions] = await Promise.all([db.items.toArray(), db.journal.toArray(), db.sessions.toArray()])
  const blob = new Blob([JSON.stringify({ app: 'my-notion-calendar', version: 1, exportedAt: new Date().toISOString(), items, journal, sessions }, null, 2)], {
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
      !!x && typeof x === 'object' && typeof (x as Item).id === 'string' && ['event', 'task', 'project', 'template', 'dday', 'note'].includes((x as Item).type),
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
  const sessions: FocusSession[] = Array.isArray(data?.sessions) ? data.sessions.filter((x: FocusSession) => x && typeof x.id === 'string' && typeof x.start === 'string') : []
  if (sessions.length) await db.sessions.bulkPut(sessions)
  return items.length
}

/* ───────── 집중 기록 ───────── */
export async function addSession(s: Omit<FocusSession, 'id' | 'updatedAt'>) {
  const row: FocusSession = { ...s, id: uid(), updatedAt: new Date().toISOString() }
  await db.sessions.add(row)
  return row
}
export function deleteSession(id: string) {
  return db.transaction('rw', db.sessions, db.tombstones, async () => {
    await db.sessions.delete(id)
    await db.tombstones.put({ id, deletedAt: new Date().toISOString() })
  })
}
const EMPTY_S: FocusSession[] = []
export function useSessions(from: string, to: string): FocusSession[] {
  return useLiveQuery(() => db.sessions.where('date').between(from, to, true, true).toArray(), [from, to]) ?? EMPTY_S
}
/** 항목(반복이면 모든 회차)의 집중 기록 */
export function useItemSessions(itemId: string): FocusSession[] {
  const base = itemId.split('::')[0]
  return (
    useLiveQuery(
      () => db.sessions.filter((x) => !!x.itemId && (x.itemId === itemId || x.itemId === base || x.itemId.startsWith(base + '::'))).toArray(),
      [itemId],
    ) ?? EMPTY_S
  )
}

/** 체험용 더미 데이터(id 가 'demo-' 로 시작) 한꺼번에 지우기 — 동기화로 다른 기기에서도 지워짐 */
export async function deleteDemoData(): Promise<number> {
  const items = (await db.items.toArray()).filter((x) => x.id.startsWith('demo-'))
  const sessions = (await db.sessions.toArray()).filter((x) => x.id.startsWith('demo-'))
  for (const it of items) await deleteItem(it.id, { trash: false })
  for (const s of sessions) await deleteSession(s.id)
  return items.length
}
