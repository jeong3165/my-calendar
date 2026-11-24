import type { Item } from '../types'
import type { Tombstone } from '../db'

/** GitHub 비공개 저장소에 저장되는 파일 형식 */
export type SyncFile = {
  app: 'my-notion-calendar'
  version: 1
  updatedAt: string
  items: Item[]
  deleted: Record<string, string> // id → 삭제 시각
}

const KEEP_TOMBSTONE_DAYS = 180

/**
 * 두 쪽 데이터를 합친다.
 * - 같은 항목: updatedAt 이 더 최근인 쪽이 이긴다
 * - 삭제 기록이 항목의 마지막 수정보다 나중이면 삭제가 이긴다
 * - 오래된 삭제 기록은 정리
 */
export function mergeData(
  local: { items: Item[]; tombstones: Tombstone[] },
  remote: SyncFile | null,
  now = new Date(),
): { items: Item[]; deleted: Record<string, string> } {
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

  return {
    items: [...items.values()].sort((a, b) => a.id.localeCompare(b.id)),
    deleted: Object.fromEntries([...deleted.entries()].sort(([a], [b]) => a.localeCompare(b))),
  }
}

/** 내용이 같은지 빠르게 비교하기 위한 지문 */
export function signature(items: Pick<Item, 'id' | 'updatedAt'>[], deleted: Record<string, string> | Tombstone[]): string {
  const i = items
    .map((x) => `${x.id}@${x.updatedAt}`)
    .sort()
    .join(',')
  const d = (Array.isArray(deleted) ? deleted.map((t) => `${t.id}@${t.deletedAt}`) : Object.entries(deleted).map(([id, at]) => `${id}@${at}`))
    .sort()
    .join(',')
  return `${i}|${d}`
}
