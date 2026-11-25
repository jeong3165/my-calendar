import type { FocusSession, Item, Journal } from '../types'
import type { Tombstone } from '../db'

/** GitHub 비공개 저장소에 저장되는 파일 형식 */
export type SyncFile = {
  app: 'my-notion-calendar'
  version: 1
  updatedAt: string
  items: Item[]
  deleted: Record<string, string> // id → 삭제 시각
  journal?: Journal[] // 하루 기록 (날짜별, 나중에 고친 쪽이 이김)
  sessions?: FocusSession[] // 집중 타이머 기록
  trash?: Record<string, Item | null> // 휴지통 사본 (30일). null = 영구 삭제함
}

const KEEP_TOMBSTONE_DAYS = 180
const KEEP_TRASH_DAYS = 30

/**
 * 두 쪽 데이터를 합친다.
 * - 같은 항목: updatedAt 이 더 최근인 쪽이 이긴다
 * - 삭제 기록이 항목의 마지막 수정보다 나중이면 삭제가 이긴다
 * - 오래된 삭제 기록은 정리
 */
export function mergeData(
  local: { items: Item[]; tombstones: Tombstone[]; journal?: Journal[]; sessions?: FocusSession[] },
  remote: SyncFile | null,
  now = new Date(),
): { items: Item[]; deleted: Record<string, string>; journal: Journal[]; sessions: FocusSession[]; trash: Record<string, Item | null> } {
  const deleted = new Map<string, string>()
  const addTomb = (id: string, at: string) => {
    const cur = deleted.get(id)
    if (!cur || at > cur) deleted.set(id, at)
  }
  for (const t of local.tombstones) addTomb(t.id, t.deletedAt)
  for (const [id, at] of Object.entries(remote?.deleted ?? {})) addTomb(id, at)

  const items = new Map<string, Item>()
  const consider = (it: Item) => {
    const cur = items.get(it.id)
    if (!cur || it.updatedAt > cur.updatedAt) items.set(it.id, it)
  }
  for (const it of remote?.items ?? []) consider(it)
  for (const it of local.items) consider(it)

  for (const [id, it] of items) {
    const at = deleted.get(id)
    if (!at) continue
    if (at >= it.updatedAt) items.delete(id)
    else deleted.delete(id) // 지운 뒤 다른 기기에서 다시 고친 경우 → 살린다
  }

  const cutoff = new Date(now.getTime() - KEEP_TOMBSTONE_DAYS * 86400000).toISOString()
  for (const [id, at] of deleted) if (at < cutoff) deleted.delete(id)

  // 휴지통 사본: 영구 삭제(null)가 이기고, 아직 지워진 상태인 30일 안의 것만 남김
  const trashIn = new Map<string, Item | null>()
  const putTrash = (id: string, v: Item | null | undefined) => {
    if (v === undefined) return
    if (v === null || !trashIn.has(id)) trashIn.set(id, v)
  }
  for (const t of local.tombstones) putTrash(t.id, t.item)
  for (const [id, v] of Object.entries(remote?.trash ?? {})) putTrash(id, v)
  const trashCut = new Date(now.getTime() - KEEP_TRASH_DAYS * 86400000).toISOString()
  const trash: Record<string, Item | null> = {}
  for (const [id, v] of [...trashIn.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const at = deleted.get(id)
    if (at && at >= trashCut) trash[id] = v
  }

  const journal = new Map<string, Journal>()
  for (const j of [...(remote?.journal ?? []), ...(local.journal ?? [])]) {
    const cur = journal.get(j.date)
    if (!cur || j.updatedAt > cur.updatedAt) journal.set(j.date, j)
  }

  // 집중 기록: id 별로 합치고, 지운 기록은 뺀다
  const sessions = new Map<string, FocusSession>()
  for (const x of [...(remote?.sessions ?? []), ...(local.sessions ?? [])]) {
    const cur = sessions.get(x.id)
    if (!cur || x.updatedAt > cur.updatedAt) sessions.set(x.id, x)
  }
  for (const [id, x] of sessions) {
    const at = deleted.get(id)
    if (at && at >= x.updatedAt) sessions.delete(id)
  }

  return {
    sessions: [...sessions.values()].sort((a, b) => a.start.localeCompare(b.start)),
    journal: [...journal.values()].sort((a, b) => a.date.localeCompare(b.date)),
    items: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)),
    deleted: Object.fromEntries([...deleted.entries()].sort(([a], [b]) => a.localeCompare(b))),
    trash,
  }
}

/** 내용이 같은지 빠르게 비교하기 위한 지문 */
export function signature(
  items: Pick<Item, 'id' | 'updatedAt'>[],
  deleted: Record<string, string> | Tombstone[],
  journal: Pick<Journal, 'date' | 'updatedAt'>[] = [],
  sessions: Pick<FocusSession, 'id' | 'updatedAt'>[] = [],
  trash: Record<string, Item | null> | Tombstone[] = [],
): string {
  const t = (Array.isArray(trash) ? trash.filter((x) => x.item !== undefined).map((x) => `${x.id}${x.item ? '' : '!'}`) : Object.entries(trash).map(([id, v]) => `${id}${v ? '' : '!'}`))
    .sort()
    .join(',')
  const i = items
    .map((x) => `${x.id}@${x.updatedAt}`)
    .sort()
    .join(',')
  const d = (Array.isArray(deleted) ? deleted.map((t) => `${t.id}@${t.deletedAt}`) : Object.entries(deleted).map(([id, at]) => `${id}@${at}`))
    .sort()
    .join(',')
  const j = journal
    .map((x) => `${x.date}@${x.updatedAt}`)
    .sort()
    .join(',')
  const f = sessions
    .map((x) => `${x.id}@${x.updatedAt}`)
    .sort()
    .join(',')
  return `${i}|${d}|${j}|${f}|${t}`
}
