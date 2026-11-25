// 엑셀(CSV) 내보내기: 기간·종류·프로젝트를 골라 일정과 할 일을 표로
import { addDays, differenceInMinutes, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { Item } from '../types'
import { PRIORITY_LABEL } from '../types'
import { parseYmd, ymd } from './date'
import { isTimed, taskKey } from './items'
import { expandItems, isRecurring } from './recur'

export type CsvOptions = {
  from: string // YYYY-MM-DD
  to: string // 포함
  events: boolean
  tasks: boolean
  undated: boolean // 날짜 없는 할 일도
  includeDone: boolean
  projectId: string // '' = 전체, 'none' = 프로젝트 없음
  subs: boolean // 구독 캘린더 일정도
}

const HEAD = ['유형', '제목', '날짜', '요일', '시작', '종료', '시간(분)', '종일', '마감일', '상태', '우선순위', '프로젝트', '태그', '메모', '완료한 때', '캘린더', '반복']

/** 엑셀이 깨지지 않게: 쉼표·따옴표·줄바꿈이 있으면 따옴표로, 수식으로 읽히는 첫 글자는 막기 */
function cell(v: string | number | undefined | null): string {
  let s = v === undefined || v === null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildRows(all: Item[], o: CsvOptions): string[][] {
  const f = parseYmd(o.from)
  const t = addDays(parseYmd(o.to), 1)
  const pname = new Map(all.filter((x) => x.type === 'project').map((p) => [p.id, p.title]))
  const okProject = (it: Item) => !o.projectId || (o.projectId === 'none' ? !it.projectId : it.projectId === o.projectId)
  const rows: { key: string; row: string[] }[] = []

  for (const it of expandItems(all.filter((x) => x.type === 'event' || x.type === 'task'), f, t)) {
    if (it.type === 'event' && !o.events) continue
    if (it.type === 'task' && !o.tasks) continue
    if (it.readonly && (!o.subs || it.readonly.subId === 'dday')) continue
    if (it.type === 'task' && it.done && !o.includeDone) continue
    if (!okProject(it)) continue
    const day = it.start ? ymd(new Date(it.start)) : taskKey(it)
    if (!day) continue
    const endDay = it.allDay && it.end ? ymd(new Date(it.end)) : day
    if (endDay < o.from || day > o.to) continue
    const timed = isTimed(it)
    rows.push({
      key: `${day} ${timed ? it.start : ''}`,
      row: [
        it.type === 'event' ? '일정' : '할 일',
        it.title || '(제목 없음)',
        it.allDay && endDay !== day ? `${day} ~ ${endDay}` : day,
        format(parseYmd(day), 'EEE', { locale: ko }),
        timed ? format(new Date(it.start!), 'HH:mm') : '',
        timed ? format(new Date(it.end!), 'HH:mm') : '',
        timed ? String(differenceInMinutes(new Date(it.end!), new Date(it.start!))) : '',
        it.allDay ? '예' : '',
        it.type === 'task' ? (it.due ?? '') : '',
        it.type === 'task' ? (it.done ? '완료' : it.doing ? '진행 중' : '할 일') : '',
        it.type === 'task' ? PRIORITY_LABEL[it.priority ?? 'normal'] : '',
        (it.projectId && pname.get(it.projectId)) || '',
        it.tags.join(', '),
        it.note ?? '',
        it.doneAt ? format(new Date(it.doneAt), 'yyyy-MM-dd HH:mm') : '',
        it.readonly?.name ?? '',
        it.occ || isRecurring(it) ? '반복' : '',
      ],
    })
  }

  if (o.undated && o.tasks)
    for (const it of all)
      if (it.type === 'task' && !it.due && !it.start && !isRecurring(it) && (o.includeDone || !it.done) && okProject(it))
        rows.push({
          key: '￿',
          row: ['할 일', it.title || '(제목 없음)', '', '', '', '', '', '', '', it.done ? '완료' : it.doing ? '진행 중' : '할 일', PRIORITY_LABEL[it.priority ?? 'normal'], (it.projectId && pname.get(it.projectId)) || '', it.tags.join(', '), it.note ?? '', it.doneAt ? format(new Date(it.doneAt), 'yyyy-MM-dd HH:mm') : '', '', ''],
        })

  return rows.sort((a, b) => a.key.localeCompare(b.key)).map((r) => r.row)
}

export function toCsv(rows: string[][]): string {
  return [HEAD, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}

/** 엑셀에서 한글이 깨지지 않게 BOM 을 붙여 저장 */
export function downloadCsv(csv: string, name: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
