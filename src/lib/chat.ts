// AI 채팅의 가벼운 부분: 대화 저장, 캘린더 도구 실행. (Anthropic SDK 는 chatAgent.ts 에서 필요할 때만 불러온다)
import { addDays, differenceInCalendarDays, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, updateItem, type Chat, type ChatAction } from '../db'
import type { Item } from '../types'
import { parseYmd, ymd } from './date'
import { dayItems, isTimed } from './items'
import { expandItems, parseOccId, resolveItem, toggleOccurrenceDone } from './recur'
import { useSubs } from './subs'
import { applyProposals, undoApply, type Proposal } from './assistant'

const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`)

/* ───────── 대화 저장 (IndexedDB, 이 기기에만) ───────── */
const EMPTY: Chat[] = []
export function useChats(): Chat[] {
  return useLiveQuery(() => db.chats.orderBy('updatedAt').reverse().toArray(), []) ?? EMPTY
}
export function useChat(id: string | null): Chat | undefined {
  return useLiveQuery(() => (id ? db.chats.get(id) : undefined), [id])
}
export async function newChat(): Promise<Chat> {
  const now = new Date().toISOString()
  const c: Chat = { id: uid(), title: '새 대화', createdAt: now, updatedAt: now, messages: [], actions: {} }
  await db.chats.put(c)
  return c
}
export const saveChat = (id: string, patch: Partial<Chat>) => db.chats.update(id, { ...patch, updatedAt: new Date().toISOString() })
export const deleteChat = (id: string) => db.chats.delete(id)

/* ───────── 내 캘린더 (내 항목 + 켜 둔 구독 캘린더) ───────── */
async function allItems(): Promise<Item[]> {
  const own = (await db.items.toArray()).filter((x) => x.type !== 'template')
  const subs = useSubs.getState().list.filter((s) => s.enabled)
  if (!subs.length) return own
  const rows = await db.subcache.bulkGet(subs.map((s) => s.id))
  const sub = rows.flatMap((r) => {
    const s = r && subs.find((x) => x.id === r.id)
    return r && s ? r.items.map((it) => ({ ...it, readonly: { subId: s.id, name: s.name } })) : []
  })
  return [...own, ...sub]
}

const hm = (iso: string) => format(new Date(iso), 'HH:mm')
const projectName = (all: Item[], id?: string) => (id ? all.find((p) => p.id === id)?.title : undefined)

function brief(it: Item, all: Item[]) {
  return {
    id: it.id,
    type: it.type === 'task' ? '할 일' : it.type === 'project' ? '프로젝트 마감' : '일정',
    title: it.title || '(제목 없음)',
    ...(isTimed(it) ? { time: `${hm(it.start!)}~${hm(it.end!)}` } : it.allDay ? { time: '종일' } : {}),
    ...(it.type === 'task' ? { done: !!it.done, due: it.due ?? null, priority: it.priority ?? 'normal' } : {}),
    ...(it.tags.length ? { tags: it.tags } : {}),
    ...(projectName(all, it.projectId) ? { project: projectName(all, it.projectId) } : {}),
    ...(it.note ? { note: it.note.slice(0, 200) } : {}),
    ...(it.readonly ? { calendar: it.readonly.name, readonly: true } : {}),
    ...(it.occ ? { repeating: true } : {}),
  }
}

export type SearchInput = { from: string; to: string; query?: string | null }
export async function searchCalendar({ from, to, query }: SearchInput) {
  const all = await allItems()
  const f = parseYmd(from)
  let t = parseYmd(to)
  if (differenceInCalendarDays(t, f) > 92) t = addDays(f, 92) // 너무 넓은 범위는 3개월로 자르기
  if (t < f) return { error: 'to 가 from 보다 앞입니다.' }
  const q = query?.trim().toLowerCase()
  const hit = (it: Item) => !q || [it.title, it.note ?? '', ...it.tags, projectName(all, it.projectId) ?? ''].some((s) => s.toLowerCase().includes(q))
  const expanded = expandItems(all, f, addDays(t, 1))
  const days: { date: string; items: ReturnType<typeof brief>[] }[] = []
  for (let d = f; d <= t; d = addDays(d, 1)) {
    const { allDay, timed } = dayItems(expanded, d)
    const items = [...allDay, ...timed].filter(hit).map((it) => brief(it, all))
    if (items.length) days.push({ date: format(d, 'yyyy-MM-dd (EEE)', { locale: ko }), items })
  }
  // 검색어가 있으면 날짜 없는 할 일도 함께
  const undated = q ? all.filter((it) => it.type === 'task' && !it.due && !it.start && hit(it)).slice(0, 50).map((it) => brief(it, all)) : []
  return { range: `${ymd(f)} ~ ${ymd(t)}`, days, ...(undated.length ? { undated_tasks: undated } : {}), ...(days.length || undated.length ? {} : { note: '해당하는 항목이 없습니다.' }) }
}

export type AddInput = {
  items: { type: 'event' | 'task'; title: string; date: string; start_time?: string | null; end_time?: string | null; note?: string | null }[]
}
export async function addItems({ items }: AddInput): Promise<{ result: unknown; action: ChatAction }> {
  const props: Proposal[] = items.map((x, i) => ({
    key: String(i),
    include: true,
    kind: 'create',
    type: x.type,
    title: x.title,
    date: x.date,
    start: x.start_time && x.end_time ? x.start_time : '',
    end: x.start_time && x.end_time ? x.end_time : '',
    reason: '',
  }))
  const undo = await applyProposals(props)
  // 메모는 따로 넣기
  await Promise.all(undo.created.map((id, i) => (items[i]?.note ? updateItem(id, { note: items[i].note! }) : undefined)))
  const summary = items.map((x) => `${x.title} · ${format(parseYmd(x.date), 'M/d(EEE)', { locale: ko })}${x.start_time && x.end_time ? ` ${x.start_time}~${x.end_time}` : ''}`).join('\n')
  return { result: { created: undo.created.map((id, i) => ({ id, title: items[i].title })) }, action: { kind: 'add', summary, undo } }
}

export async function completeTask({ id }: { id: string }): Promise<{ result: unknown; action?: ChatAction }> {
  const all = await allItems()
  const it = resolveItem(all, id)
  if (!it) return { result: { error: '그런 id 의 항목이 없습니다. search_calendar 로 먼저 찾아 주세요.' } }
  if (it.type !== 'task') return { result: { error: '할 일만 완료로 표시할 수 있습니다.' } }
  if (it.readonly) return { result: { error: '구독 캘린더 항목은 바꿀 수 없습니다.' } }
  if (it.done) return { result: { ok: true, note: '이미 완료된 할 일입니다.' } }
  const seriesId = parseOccId(id)?.seriesId ?? it.id
  const before = await db.items.get(seriesId)
  if (!before) return { result: { error: '항목을 찾지 못했습니다.' } }
  if (it.occ) await toggleOccurrenceDone(it)
  else await updateItem(it.id, { done: true, doing: undefined, doneAt: new Date().toISOString() })
  return { result: { ok: true }, action: { kind: 'done', summary: it.title, undo: { created: [], before: [before] } } }
}

export async function undoAction(chatId: string, toolId: string) {
  const c = await db.chats.get(chatId)
  const a = c?.actions[toolId]
  if (!c || !a || a.undone) return
  await undoApply(a.undo)
  await saveChat(chatId, { actions: { ...c.actions, [toolId]: { ...a, undone: true } } })
}

/* ───────── 화면에 보여 줄 현재 시각 꼬리표 ───────── */
export const NOW_TAG = '[앱 정보] '
export const nowNote = (now = new Date()) =>
  `${NOW_TAG}지금은 ${format(now, 'yyyy-MM-dd (EEEE) HH:mm', { locale: ko })}, 시간대 ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`
