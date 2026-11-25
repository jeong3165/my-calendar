import { addDays, format, startOfDay } from 'date-fns'
import { ko } from 'date-fns/locale'
import { createItem, db, deleteItem, updateItem } from '../db'
import type { Item } from '../types'
import { parseYmd, ymd } from './date'
import { isTimed, timedSegment } from './items'
import { expandItems, isRecurring, resolveItem } from './recur'

/* ───────── 설정: 일정을 넣어도 되는 시간대 ───────── */
export type AssistantSettings = { dayStart: string; dayEnd: string; days: number }
const KEY = 'my-calendar.assistant'
const DEFAULTS: AssistantSettings = { dayStart: '09:00', dayEnd: '21:00', days: 21 }
export function loadAssistant(): AssistantSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}
export function saveAssistant(s: AssistantSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}
const toHm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/* ───────── Claude 에게 보낼 내 캘린더 요약 ───────── */
type Busy = { date: string; s: number; e: number; title: string; id: string }

/** 그날 이미 차 있는 시간 (분 단위) */
export function busyOn(all: Item[], date: string, exclude?: Set<string>): Busy[] {
  const d = parseYmd(date)
  return expandItems(all, d, addDays(d, 1))
    .filter((it) => it.type !== 'project' && isTimed(it) && !(it.type === 'task' && it.done) && !exclude?.has(it.id) && !exclude?.has(it.occ?.seriesId ?? ''))
    .flatMap((it) => {
      const seg = timedSegment(it, d) // 그날에 걸치지 않는 일정은 빼기
      return seg ? [{ date, s: seg.startMin, e: seg.endMin, title: it.title, id: it.id }] : []
    })
    .sort((a, b) => a.s - b.s)
}

export function buildContext(all: Item[], now = new Date(), st = loadAssistant()) {
  const today = ymd(now)
  const from = startOfDay(now)
  const to = addDays(from, st.days)
  const projects = all.filter((x) => x.type === 'project' && !x.done)
  const pname = (id?: string) => projects.find((p) => p.id === id)?.title ?? null
  const nowMin = now.getHours() * 60 + now.getMinutes()

  const tasks = all
    .filter((x) => x.type === 'task' && !x.done && !isRecurring(x))
    .slice(0, 120)
    .map((t) => ({
      id: t.id,
      title: t.title,
      due: t.due ?? null,
      priority: t.priority ?? 'normal',
      project: pname(t.projectId),
      time_block: isTimed(t) ? `${ymd(new Date(t.start!))} ${format(new Date(t.start!), 'HH:mm')}-${format(new Date(t.end!), 'HH:mm')}` : null,
      subtasks: t.subtasks?.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length}` : null,
    }))

  const events = expandItems(all, from, to)
    .filter((x) => x.type === 'event' || (x.type === 'task' && isTimed(x) && isRecurring(x)))
    .map((e) => ({
      id: e.id,
      title: e.title,
      date: e.start ? ymd(new Date(e.start)) : e.due,
      time: e.allDay || !e.start ? '종일' : `${format(new Date(e.start), 'HH:mm')}-${format(new Date(e.end!), 'HH:mm')}`,
      // 반복·구독·지난 일정은 옮기지 않는다
      fixed: !!(e.occ || e.readonly || (e.end && new Date(e.end) < now)),
      calendar: e.readonly?.name ?? null,
    }))

  const free: { date: string; weekday: string; free: string[] }[] = []
  for (let d = from; d < to; d = addDays(d, 1)) {
    const key = ymd(d)
    let cur = toMin(st.dayStart)
    const end = toMin(st.dayEnd)
    if (key === today) cur = Math.max(cur, Math.ceil(nowMin / 15) * 15)
    const slots: string[] = []
    for (const b of busyOn(all, key)) {
      if (b.e <= cur) continue
      if (b.s >= end) break
      if (b.s - cur >= 15) slots.push(`${toHm(cur)}-${toHm(Math.min(b.s, end))}`)
      cur = Math.max(cur, b.e)
    }
    if (end - cur >= 15) slots.push(`${toHm(cur)}-${toHm(end)}`)
    free.push({ date: key, weekday: format(d, 'EEE', { locale: ko }), free: slots })
  }

  const text = [
    `지금: ${format(now, 'yyyy-MM-dd (EEE) HH:mm', { locale: ko })} · 시간대 ${Intl.DateTimeFormat().resolvedOptions().timeZone}`,
    `일정을 넣어도 되는 시간: 매일 ${st.dayStart}–${st.dayEnd} (사용자가 따로 말하면 그 말을 따른다)`,
    `계획 범위: ${today} ~ ${ymd(addDays(to, -1))}`,
    `\n[프로젝트]\n${JSON.stringify(projects.map((p) => ({ name: p.title, due: p.due ?? null })))}`,
    `\n[아직 안 끝난 할 일] (id 로 가리킨다)\n${tasks.map((t) => JSON.stringify(t)).join('\n') || '없음'}`,
    `\n[범위 안의 일정] fixed=true 는 옮기면 안 됨\n${events.map((e) => JSON.stringify(e)).join('\n') || '없음'}`,
    `\n[빈 시간] 이미 일정·시간 블록이 있는 시간은 빠져 있다\n${free.map((f) => JSON.stringify(f)).join('\n')}`,
  ].join('\n')
  return { text, taskIds: new Set(tasks.map((t) => t.id)), movableIds: new Set([...tasks.map((t) => t.id), ...events.filter((e) => !e.fixed).map((e) => e.id)]) }
}

/* ───────── 제안 (검토 화면에서 고칠 수 있는 형태) ───────── */
export type ActionKind = 'create' | 'schedule' | 'move' | 'set_due'
export type Proposal = {
  key: string
  include: boolean
  kind: ActionKind
  itemId?: string
  type: 'event' | 'task'
  title: string
  date: string
  start: string // HH:MM 또는 ''
  end: string
  projectId?: string
  reason: string
  problem?: string // 적용할 수 없는 이유
}

export type RawAction = {
  kind: ActionKind
  item_id: string | null
  type: 'event' | 'task' | null
  title: string | null
  date: string
  start_time: string | null
  end_time: string | null
  project: string | null
  reason: string
}

const normTime = (t: string | null) => {
  const m = t?.match(/^(\d{1,2}):(\d{2})/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : ''
}
let seq = 0

export function toProposals(actions: RawAction[], all: Item[], ctx: { taskIds: Set<string>; movableIds: Set<string> }): Proposal[] {
  const projects = all.filter((x) => x.type === 'project')
  return actions.map((a) => {
    const target = a.item_id ? resolveItem(all, a.item_id) : undefined // 반복 회차 id 도 찾는다
    const p: Proposal = {
      key: `p${seq++}`,
      include: true,
      kind: a.kind,
      itemId: a.item_id ?? undefined,
      type: a.kind === 'create' ? (a.type ?? 'task') : target?.type === 'event' ? 'event' : 'task',
      title: a.kind === 'create' ? (a.title ?? '').trim() : (target?.title ?? a.title ?? ''),
      date: /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : '',
      start: normTime(a.start_time),
      end: normTime(a.end_time),
      projectId: a.project ? projects.find((x) => x.title.replace(/\s/g, '') === a.project!.replace(/\s/g, ''))?.id : target?.projectId,
      reason: a.reason,
    }
    if (a.kind !== 'create' && (!target || !ctx.movableIds.has(target.id))) p.problem = '바꿀 수 없는 항목이에요 (반복·구독 일정이거나 찾을 수 없음)'
    if (!p.date) p.problem = '날짜가 올바르지 않아요'
    if (a.kind === 'schedule' && (!p.start || !p.end)) p.problem = '시간이 빠졌어요'
    if (p.problem) p.include = false
    return p
  })
}

export function checkProposal(p: Proposal): string | undefined {
  if (!p.title.trim()) return '제목을 입력해 주세요'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return '날짜를 입력해 주세요'
  if ((p.start && !p.end) || (!p.start && p.end && p.kind !== 'move')) return '시작·종료 시간을 함께 넣어 주세요'
  if (p.start && p.end && p.end <= p.start) return '종료 시간이 시작보다 빨라요'
  if (p.kind === 'schedule' && !p.start) return '시간 블록에는 시간이 필요해요'
  return undefined
}

/** 다른 일정이나 다른 제안과 겹치는지 */
export function conflicts(p: Proposal, all: Item[], others: Proposal[]): string | undefined {
  if (!p.start || !p.end || !p.date) return
  const s = toMin(p.start)
  const e = toMin(p.end)
  const hit = busyOn(all, p.date, p.itemId ? new Set([p.itemId]) : undefined).find((b) => b.s < e && b.e > s)
  if (hit) return `겹침: ${hit.title} ${toHm(hit.s)}–${toHm(hit.e)}`
  const mine = others.find((o) => o !== p && o.include && o.date === p.date && o.start && o.end && toMin(o.start) < e && toMin(o.end) > s)
  if (mine) return `다른 제안과 겹침: ${mine.title}`
}

const at = (date: string, hm: string) => {
  const d = parseYmd(date)
  const [h, m] = hm.split(':').map(Number)
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

/* ───────── 적용과 되돌리기 ───────── */
export type Undo = { created: string[]; before: Item[] }

export async function applyProposals(list: Proposal[]): Promise<Undo> {
  const undo: Undo = { created: [], before: [] }
  for (const p of list) {
    if (p.kind === 'create') {
      const timed = !!(p.start && p.end)
      const it = await createItem({
        type: p.type,
        title: p.title.trim(),
        projectId: p.projectId,
        ...(timed ? { start: at(p.date, p.start), end: at(p.date, p.end) } : {}),
        ...(p.type === 'task' ? { due: p.date } : timed ? {} : { allDay: true, start: parseYmd(p.date).toISOString(), end: parseYmd(p.date).toISOString() }),
      })
      undo.created.push(it.id)
      continue
    }
    const cur = await db.items.get(p.itemId!)
    if (!cur) continue
    undo.before.push(cur)
    if (p.kind === 'set_due') await updateItem(cur.id, { due: p.date })
    else if (p.start && p.end) await updateItem(cur.id, { start: at(p.date, p.start), end: at(p.date, p.end), allDay: undefined })
    else if (cur.start) {
      // 시간 없이 날짜만 옮기면 원래 시각과 길이를 유지
      const s0 = new Date(cur.start)
      const dur = new Date(cur.end ?? cur.start).getTime() - s0.getTime()
      const s = at(p.date, format(s0, 'HH:mm'))
      await updateItem(cur.id, { start: s, end: new Date(new Date(s).getTime() + dur).toISOString(), ...(cur.type === 'task' ? { due: p.date } : {}) })
    } else await updateItem(cur.id, { due: p.date })
  }
  return undo
}

export async function undoApply(u: Undo) {
  for (const id of u.created) await deleteItem(id)
  const now = new Date().toISOString()
  // 원래 값으로 되돌리되, 동기화에서 '최신'으로 보이도록 수정 시각은 지금으로
  if (u.before.length) await db.items.bulkPut(u.before.map((x) => ({ ...x, updatedAt: now })))
}

export const KIND_LABEL: Record<ActionKind, string> = { create: '새로 만들기', schedule: '시간 배치', move: '옮기기', set_due: '마감일 변경' }
export const fmtDay = (d: string) => (d ? format(parseYmd(d), 'M월 d일 (EEE)', { locale: ko }) : '')
