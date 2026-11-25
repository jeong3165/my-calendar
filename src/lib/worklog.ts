// 일일 업무일지: 하루 동안 한 일·진행 중·못 한 일·내일 할 일을 보고용 글로
import { addDays, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { FocusSession, Item, Journal } from '../types'
import { parseYmd, ymd } from './date'
import { isTimed, taskKey } from './items'
import { dayData } from './review'
import { fmtMinutes } from './review'
import { expandItems, isRecurring } from './recur'

export type WorklogOptions = {
  events: boolean // 일정·회의 포함
  habits: boolean // 습관(반복 할 일) 포함
  tomorrow: boolean // 내일 할 일 포함
  memo: boolean // 하루 정리 메모 포함
  tags: boolean // 항목 옆에 #태그 표시
  excludeTags: string[] // 이 태그가 붙은 항목은 빼기 (예: 개인)
  byProject: boolean // 프로젝트별로 묶기
}
export const WORKLOG_DEFAULT: WorklogOptions = { events: true, habits: false, tomorrow: true, memo: true, tags: false, excludeTags: ['개인'], byProject: true }
const KEY = 'my-calendar.worklog'
export function loadWorklog(): WorklogOptions {
  try {
    return { ...WORKLOG_DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { ...WORKLOG_DEFAULT }
  }
}
export function saveWorklog(o: WorklogOptions) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o))
  } catch {
    /* ignore */
  }
}

const hm = (iso: string) => format(new Date(iso), 'HH:mm')

export function worklogText(items: Item[], date: string, journal: Journal | undefined, sessions: FocusSession[], o: WorklogOptions): string {
  const d = dayData(items, date, journal, sessions)
  const pname = new Map(items.filter((x) => x.type === 'project').map((p) => [p.id, p.title || '이름 없음']))
  const skip = (it: Item) => it.readonly?.subId === 'dday' || it.tags.some((t) => o.excludeTags.includes(t)) || (!o.habits && (!!it.occ || isRecurring(it)))
  const tagStr = (it: Item) => (o.tags && it.tags.length ? ' ' + it.tags.map((t) => '#' + t).join(' ') : '')
  const sub = (it: Item) => (it.subtasks?.length ? ` (${it.subtasks.filter((s) => s.done).length}/${it.subtasks.length})` : '')
  const focus = (it: Item) => {
    const m = d.focusByItem.get(it.id)
    return m ? ` · 집중 ${fmtMinutes(m)}` : ''
  }
  const line = (it: Item, extra = '') => `- ${it.title || '(제목 없음)'}${sub(it)}${extra}${focus(it)}${tagStr(it)}`

  /** 프로젝트별로 묶어 여러 줄 */
  const block = (list: Item[], extra: (it: Item) => string = () => ''): string[] => {
    if (!o.byProject) return list.map((it) => line(it, extra(it)))
    const groups = new Map<string, Item[]>()
    for (const it of list) {
      const k = (it.projectId && pname.get(it.projectId)) || ''
      groups.set(k, [...(groups.get(k) ?? []), it])
    }
    const out: string[] = []
    for (const [k, l] of [...groups.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b)))) {
      if (k) out.push(`[${k}]`)
      out.push(...l.map((it) => (k ? '  ' : '') + line(it, extra(it))))
    }
    return out
  }

  const done = [...d.plannedDone, ...d.unplannedDone].filter((x) => !skip(x))
  const doneIds = new Set(done.map((x) => x.id))
  const doing = items.filter((x) => x.type === 'task' && x.doing && !x.done && !doneIds.has(x.id) && !skip(x))
  const doingIds = new Set(doing.map((x) => x.id))
  const left = d.planned.filter((x) => !x.done && !doingIds.has(x.id) && !skip(x))
  const events = d.events.filter((e) => !skip(e))
  const next = ymd(addDays(parseYmd(date), 1))
  const nd = parseYmd(next)
  const tmrw = expandItems(items, nd, addDays(nd, 1))
  const tmrwTasks = tmrw.filter((x) => x.type === 'task' && !x.done && taskKey(x) === next && !skip(x))
  const tmrwEvents = tmrw.filter((x) => x.type === 'event' && x.start && ymd(new Date(x.start)) === next && !skip(x)).sort((a, b) => a.start!.localeCompare(b.start!))

  const L: string[] = [`■ 업무일지 · ${format(parseYmd(date), 'yyyy년 M월 d일 (EEE)', { locale: ko })}`]
  L.push('', `1. 완료한 일 (${done.length})`, ...(done.length ? block(done) : ['- 없음']))
  if (doing.length) L.push('', `2. 진행 중 (${doing.length})`, ...block(doing))
  if (left.length) L.push('', `${doing.length ? 3 : 2}. 못 끝낸 일 → 이월 (${left.length})`, ...block(left, (it) => (taskKey(it) && taskKey(it)! < date ? ` (마감 ${taskKey(it)!.slice(5).replace('-', '/')})` : '')))
  let n = 2 + Number(!!doing.length) + Number(!!left.length)
  if (o.events && events.length) {
    L.push('', `${n++}. 일정·회의 (${events.length})`)
    for (const e of events) L.push(`- ${isTimed(e) ? `${hm(e.start!)}~${hm(e.end!)} ` : '(종일) '}${e.title || '(제목 없음)'}${e.readonly ? ` [${e.readonly.name}]` : ''}${tagStr(e)}`)
  }
  if (o.tomorrow && (tmrwTasks.length || tmrwEvents.length)) {
    L.push('', `${n++}. 내일 할 일`)
    for (const e of tmrwEvents) L.push(`- ${isTimed(e) ? hm(e.start!) + ' ' : '(종일) '}${e.title || '(제목 없음)'}`)
    for (const t of tmrwTasks) L.push(line(t))
  }
  if (d.focusMinutes) L.push('', `· 집중 시간: ${fmtMinutes(d.focusMinutes)} (${d.focusCount}회)`)
  if (o.memo && journal && (journal.note || journal.good || journal.better)) {
    L.push('', '· 메모')
    if (journal.note) L.push(`  ${journal.note}`)
    if (journal.good) L.push(`  잘한 점: ${journal.good}`)
    if (journal.better) L.push(`  아쉬운 점: ${journal.better}`)
  }
  return L.join('\n')
}
