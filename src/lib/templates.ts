import { useMemo } from 'react'
import { addDays, differenceInCalendarDays, format } from 'date-fns'
import { createItem, useItems } from '../db'
import type { Item, Priority, TemplateData } from '../types'
import { parseYmd, ymd } from './date'
import { isTimed } from './items'
import { parseQuick } from './parse'
import { isRecurring } from './recur'
import { newSubtask } from './projects'

/**
 * 템플릿 글 형식 (한 줄에 할 일 하나)
 *   07:00 스트레칭 #습관            ← 기준일에
 *   +1 09:00-10:00 짐 정리         ← 기준일 다음 날
 *   D-30 이삿짐 센터 견적 받기 !높음  ← 기준일(마감일) 30일 전
 *   2일차 체크아웃                   ← 기준일이 1일차
 *     - 신분증                      ← 들여쓴 '- '줄은 바로 위 할 일의 하위 할 일
 *   // 메모                          ← // 로 시작하면 무시
 */
export type TemplateTask = { title: string; offset: number; start?: string; end?: string; priority?: Priority; tags: string[]; subtasks: string[] }

const hm = (t?: { h: number; m: number }) => (t ? `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}` : undefined)

export function parseTemplate(text: string): TemplateTask[] {
  const out: TemplateTask[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('//')) continue
    const sub = raw.match(/^\s+[-*•]\s*(.+)$/)
    if (sub && out.length) {
      out[out.length - 1].subtasks.push(sub[1].trim())
      continue
    }
    let line = raw.trim().replace(/^[-*•]\s+/, '')
    let offset = 0
    const m = line.match(/^(?:D-(\d+)|D\+(\d+)|\+(\d+)|(\d+)\s*일차)\s+/i)
    if (m) {
      offset = m[1] ? -Number(m[1]) : m[2] ? Number(m[2]) : m[3] ? Number(m[3]) : Number(m[4]) - 1
      line = line.slice(m[0].length)
    }
    const p = parseQuick(line, new Date(), { noDate: true }) // 날짜는 +1·D-7 로만 정한다
    if (!p.title) continue
    out.push({ title: p.title, offset, start: hm(p.start), end: hm(p.end), priority: p.priority, tags: p.tags, subtasks: [] })
  }
  return out
}

/** 기준일에 맞춰 실제 할 일로 */
export function expandTask(t: TemplateTask, anchor: string): Partial<Item> & { type: 'task' } {
  const date = ymd(addDays(parseYmd(anchor), t.offset))
  const at = (x: string) => {
    const d = parseYmd(date)
    const [h, mi] = x.split(':').map(Number)
    d.setHours(h, mi, 0, 0)
    return d
  }
  const timed = t.start ? { start: at(t.start).toISOString(), end: (t.end ? at(t.end) : new Date(at(t.start).getTime() + 30 * 60000)).toISOString() } : {}
  return {
    type: 'task',
    title: t.title,
    due: date,
    ...timed,
    ...(t.priority ? { priority: t.priority } : {}),
    tags: t.tags,
    ...(t.subtasks.length ? { subtasks: t.subtasks.map((s) => newSubtask(s)) } : {}),
  }
}

export function useTemplates(): Item[] {
  const items = useItems()
  return useMemo(() => items.filter((x) => x.type === 'template').sort((a, b) => a.title.localeCompare(b.title)), [items])
}

export function saveTemplate(name: string, data: TemplateData, icon = '📋') {
  return createItem({ type: 'template', title: name, icon, template: data })
}

/** 적용: 만든 항목 id 들을 돌려준다 */
export async function applyTemplate(tpl: Item, anchor: string, opts: { projectTitle?: string; include?: boolean[] } = {}) {
  const data = tpl.template!
  const tasks = parseTemplate(data.text).filter((_, i) => opts.include?.[i] !== false)
  const created: string[] = []
  let projectId: string | undefined
  if (data.kind === 'project') {
    const p = await createItem({ type: 'project', title: opts.projectTitle || tpl.title, icon: data.project?.icon ?? tpl.icon, color: data.project?.color ?? 'blue', note: data.project?.note, due: anchor })
    projectId = p.id
    created.push(p.id)
  }
  for (const t of tasks) created.push((await createItem({ ...expandTask(t, anchor), projectId })).id)
  return { created, projectId }
}

/** 지금 프로젝트를 템플릿 글로 (마감일이 있으면 D-n, 없으면 오늘 기준 +n) */
export function templateFromProject(p: Item, items: Item[]): TemplateData {
  const anchor = p.due ? parseYmd(p.due) : new Date()
  const tasks = items
    .filter((x) => x.type === 'task' && x.projectId === p.id && !isRecurring(x))
    .sort((a, b) => (a.start ?? a.due ?? '9999').localeCompare(b.start ?? b.due ?? '9999'))
  const lines = tasks.map((t) => {
    const key = t.start ? ymd(new Date(t.start)) : t.due
    let prefix = ''
    if (key) {
      const diff = differenceInCalendarDays(parseYmd(key), anchor)
      prefix = p.due ? (diff < 0 ? `D${diff} ` : diff > 0 ? `D+${diff} ` : '') : diff ? `+${diff} ` : ''
    }
    const time = isTimed(t) ? `${format(new Date(t.start!), 'HH:mm')}-${format(new Date(t.end!), 'HH:mm')} ` : ''
    const extra = [t.priority === 'high' ? '!높음' : t.priority === 'low' ? '!낮음' : '', ...t.tags.map((x) => `#${x}`)].filter(Boolean).join(' ')
    const subs = (t.subtasks ?? []).map((s) => `\n  - ${s.title}`).join('')
    return `${prefix}${time}${t.title}${extra ? ` ${extra}` : ''}${subs}`
  })
  return { kind: 'project', text: lines.join('\n'), project: { color: p.color, icon: p.icon, note: p.note } }
}

/** 처음 쓰는 사람을 위한 예시 */
export const STARTERS: { name: string; icon: string; data: TemplateData }[] = [
  {
    name: '출근 루틴',
    icon: '☀️',
    data: { kind: 'list', text: '07:00-07:20 스트레칭 #건강\n08:30-09:00 메일·메신저 확인 #회사\n09:00-09:15 오늘 할 일 정리 #회사\n12:00-13:00 점심 산책' },
  },
  {
    name: '주간 회의 준비',
    icon: '🗂️',
    data: { kind: 'list', text: 'D-1 지난주 진행 상황 정리 #회사\n  - 완료한 일\n  - 막힌 일\nD-1 이번 주 우선순위 3개 뽑기 #회사 !높음\n회의록 공유 #회사' },
  },
  {
    name: '이사 준비',
    icon: '🏠',
    data: {
      kind: 'project',
      text: 'D-30 이삿짐 센터 견적 3곳 받기 !높음\nD-21 버릴 가구·가전 정리\n  - 대형폐기물 신고\n  - 중고 판매\nD-14 인터넷·가스 이전 신청\nD-7 전입신고 서류 준비\nD-3 냉장고 비우기\nD-1 귀중품·서류 따로 챙기기\n+1 전입신고 하기 !높음\n+3 주소 변경 (은행·카드·쇼핑몰)',
      project: { color: 'green', icon: '🏠' },
    },
  },
  {
    name: '여행 준비',
    icon: '✈️',
    data: {
      kind: 'project',
      text: 'D-30 항공권·숙소 예약 !높음\nD-14 여행자 보험 가입\nD-7 일정·맛집 정리\nD-3 환전\nD-1 짐 싸기\n  - 여권\n  - 충전기·어댑터\n  - 상비약\n+1 사진 정리',
      project: { color: 'blue', icon: '✈️' },
    },
  },
]
