// 업무 통계·월간 리포트
import { addDays, addMonths, endOfMonth, format, startOfMonth } from 'date-fns'
import type { FocusSession, Item } from '../types'
import { parseYmd, ymd } from './date'
import { isTimed, taskKey } from './items'
import { expandItems, isRecurring, parseOccId } from './recur'
import { dailyRatio, isHabit } from './habits'
import { fmtMinutes } from './review'

export type ProjectRow = { id: string; title: string; icon: string; color: string; total: number; done: number; doneThisMonth: number; focus: number; due?: string; finished: boolean }

export type MonthReport = {
  month: Date
  label: string
  days: { date: string; done: number; focus: number }[]
  completed: number // 이번 달 끝낸 할 일 (반복 제외)
  created: number // 이번 달 새로 만든 할 일
  slipped: Item[] // 이번 달 마감인데 아직 못 끝낸 할 일
  events: number // 일정 수 (내 캘린더)
  eventMinutes: number // 시간 있는 일정 합계
  focusMinutes: number
  focusCount: number
  habit: { due: number; done: number } // 지금까지 해야 했던 / 한 습관 회차
  projects: ProjectRow[]
  tags: { tag: string; minutes: number; count: number }[] // 일정·할 일 시간 블록 기준
  prev: { completed: number; focusMinutes: number; events: number }
  busiest?: { date: string; done: number }
}

function basics(items: Item[], sessions: FocusSession[], m0: Date) {
  const m1 = addMonths(m0, 1)
  const from = ymd(m0)
  const to = ymd(addDays(m1, -1))
  const inMonth = (iso?: string) => !!iso && iso >= from && iso <= to
  const completedList = items.filter((x) => x.type === 'task' && !isRecurring(x) && x.done && x.doneAt && inMonth(ymd(new Date(x.doneAt))))
  const ses = sessions.filter((s) => inMonth(s.date))
  const evs = expandItems(
    items.filter((x) => x.type === 'event' && !x.readonly),
    m0,
    m1,
  ).filter((e) => {
    const d = e.start ? ymd(new Date(e.start)) : ''
    return inMonth(d)
  })
  return { from, to, inMonth, completedList, ses, evs }
}

export function monthReport(items: Item[], sessions: FocusSession[], month: Date, now = new Date()): MonthReport {
  const m0 = startOfMonth(month)
  const { from, to, inMonth, completedList, ses, evs } = basics(items, sessions, m0)
  const today = ymd(now)

  // 날짜별 완료 수·집중 시간
  const days: MonthReport['days'] = []
  for (let d = m0; d <= endOfMonth(m0); d = addDays(d, 1)) days.push({ date: ymd(d), done: 0, focus: 0 })
  const byDay = new Map(days.map((d) => [d.date, d]))
  for (const t of completedList) byDay.get(ymd(new Date(t.doneAt!)))!.done++
  for (const h of items.filter(isHabit)) for (const d of h.doneDates ?? []) if (inMonth(d)) byDay.get(d)!.done++
  for (const s of ses) byDay.get(s.date)!.focus += s.minutes

  // 프로젝트별
  const itemProject = new Map(items.map((x) => [x.id, x.projectId]))
  const projects: ProjectRow[] = items
    .filter((p) => p.type === 'project')
    .map((p) => {
      const ts = items.filter((t) => t.type === 'task' && t.projectId === p.id && !isRecurring(t))
      const focus = ses.filter((s) => s.itemId && itemProject.get(parseOccId(s.itemId)?.seriesId ?? s.itemId) === p.id).reduce((a, s) => a + s.minutes, 0)
      return {
        id: p.id,
        title: p.title || '이름 없음',
        icon: p.icon ?? '📁',
        color: p.color,
        total: ts.length,
        done: ts.filter((t) => t.done).length,
        doneThisMonth: completedList.filter((t) => t.projectId === p.id).length,
        focus,
        due: p.due,
        finished: !!p.done,
      }
    })
    .filter((p) => p.total > 0 && (!p.finished || p.doneThisMonth > 0 || p.focus > 0))
    .sort((a, b) => b.doneThisMonth - a.doneThisMonth || b.focus - a.focus || a.title.localeCompare(b.title))

  // 태그별 시간 (시간 블록이 있는 일정·할 일)
  const tagMap = new Map<string, { minutes: number; count: number }>()
  const blocks = expandItems(
    items.filter((x) => (x.type === 'event' || x.type === 'task') && !x.readonly),
    m0,
    addMonths(m0, 1),
  ).filter((x) => isTimed(x) && inMonth(ymd(new Date(x.start!))))
  for (const b of blocks)
    for (const t of b.tags) {
      const cur = tagMap.get(t) ?? { minutes: 0, count: 0 }
      cur.minutes += (new Date(b.end!).getTime() - new Date(b.start!).getTime()) / 60000
      cur.count++
      tagMap.set(t, cur)
    }

  const habitTo = to < today ? to : today
  let habit = { due: 0, done: 0 }
  if (from <= habitTo) for (const v of dailyRatio(items.filter(isHabit), from, habitTo).values()) habit = { due: habit.due + v.due, done: habit.done + v.done }

  const p = basics(items, sessions, addMonths(m0, -1))
  const busiest = [...days].sort((a, b) => b.done - a.done)[0]

  return {
    month: m0,
    label: format(m0, 'yyyy년 M월'),
    days,
    completed: completedList.length,
    created: items.filter((x) => x.type === 'task' && !isRecurring(x) && inMonth(ymd(new Date(x.createdAt)))).length,
    slipped: items.filter((x) => x.type === 'task' && !isRecurring(x) && !x.done && inMonth(taskKey(x)) && (taskKey(x) ?? '') < today),
    events: evs.length,
    eventMinutes: evs.filter(isTimed).reduce((a, e) => a + (new Date(e.end!).getTime() - new Date(e.start!).getTime()) / 60000, 0),
    focusMinutes: ses.reduce((a, s) => a + s.minutes, 0),
    focusCount: ses.length,
    habit,
    projects,
    tags: [...tagMap.entries()].map(([tag, v]) => ({ tag, ...v })).sort((a, b) => b.minutes - a.minutes).slice(0, 6),
    prev: { completed: p.completedList.length, focusMinutes: p.ses.reduce((a, s) => a + s.minutes, 0), events: p.evs.length },
    busiest: busiest && busiest.done > 0 ? { date: busiest.date, done: busiest.done } : undefined,
  }
}

/** 보고서에 붙여넣을 글 */
export function reportText(r: MonthReport): string {
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-')
  const lines = [
    `■ ${r.label} 업무 리포트`,
    '',
    `· 완료한 할 일: ${r.completed}개 (지난달 ${r.prev.completed}개)`,
    `· 새로 만든 할 일: ${r.created}개`,
    `· 일정: ${r.events}개, 총 ${fmtMinutes(Math.round(r.eventMinutes))}`,
    `· 집중 시간: ${fmtMinutes(r.focusMinutes)} (${r.focusCount}회)`,
    ...(r.habit.due ? [`· 습관 달성률: ${pct(r.habit.done, r.habit.due)} (${r.habit.done}/${r.habit.due})`] : []),
  ]
  if (r.projects.length) {
    lines.push('', '■ 프로젝트별 진행')
    for (const p of r.projects) lines.push(`· ${p.title}: ${p.done}/${p.total} 완료 (${pct(p.done, p.total)}), 이번 달 ${p.doneThisMonth}개${p.focus ? `, 집중 ${fmtMinutes(p.focus)}` : ''}${p.due ? `, 마감 ${p.due}` : ''}`)
  }
  if (r.slipped.length) {
    lines.push('', '■ 이번 달 마감인데 아직 못 끝낸 일')
    for (const t of r.slipped.slice(0, 15)) lines.push(`· ${t.title || '(제목 없음)'} (마감 ${taskKey(t)})`)
  }
  return lines.join('\n')
}

export const monthKey = (d: Date) => format(d, 'yyyy-MM')
export const fromMonthKey = (k: string) => parseYmd(`${k}-01`)
