// 메모 (노션식 페이지): 항목(type 'note')으로 저장 → 동기화·휴지통·태그가 그대로 적용
import { useMemo } from 'react'
import { format, startOfWeek } from 'date-fns'
import { weekTitle } from './shareImage'
import { ko } from 'date-fns/locale'
import { createItem, updateItem, useItems } from '../db'
import type { Item } from '../types'
import { ymd } from './date'

export function useNotes(): Item[] {
  const items = useItems()
  return useMemo(() => items.filter((x) => x.type === 'note').sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt.localeCompare(a.updatedAt)), [items])
}

export const NOTE_TEMPLATES: { key: string; label: string; icon: string; title: (d: Date) => string; body: (d: Date) => string }[] = [
  { key: 'blank', label: '빈 메모', icon: '📝', title: () => '', body: () => '' },
  {
    key: 'meeting',
    label: '회의록',
    icon: '🗒️',
    title: (d) => `${format(d, 'M/d')} 회의록`,
    body: (d) => `## 회의 정보\n- 일시: ${format(d, 'yyyy년 M월 d일 (EEE) HH:mm', { locale: ko })}\n- 참석자: \n- 장소: \n\n## 안건\n1. \n\n## 논의 내용\n- \n\n## 결정 사항\n- \n\n## 할 일\n- [ ] `,
  },
  { key: 'idea', label: '아이디어', icon: '💡', title: () => '아이디어', body: () => '## 배경\n- \n\n## 아이디어\n- \n\n## 다음 단계\n- [ ] ' },
  {
    key: 'weekly',
    label: '주간 정리',
    icon: '📅',
    title: (d) => `${weekTitle(startOfWeek(d, { weekStartsOn: 1 })).replace(' 일정', '')} 정리`,
    body: () => '## 이번 주 한 일\n- \n\n## 잘된 점\n- \n\n## 아쉬운 점\n- \n\n## 다음 주 할 일\n- [ ] ',
  },
]

export async function newNote(opts: { template?: string; projectId?: string; date?: string; tags?: string[] } = {}): Promise<Item> {
  const t = NOTE_TEMPLATES.find((x) => x.key === opts.template) ?? NOTE_TEMPLATES[0]
  const now = new Date()
  return createItem({ type: 'note', title: t.title(now), note: t.body(now), projectId: opts.projectId, noteDate: opts.date ?? (t.key === 'meeting' ? ymd(now) : undefined), tags: opts.tags ?? [], color: 'gray' })
}

/** 메모 안의 "- [ ] 할 일" 줄을 진짜 할 일로 만들고, 만든 줄에는 표시를 남김 */
const MARK = ' ↗할 일'
export async function checklistToTasks(note: Item): Promise<{ count: number; body: string }> {
  const lines = (note.note ?? '').split('\n')
  let count = 0
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*[-*]\s*\[ \]\s+)(.+)$/)
    if (!m || lines[i].endsWith(MARK) || !m[2].trim()) continue
    await createItem({ type: 'task', title: m[2].trim(), projectId: note.projectId, tags: note.tags, ...(note.noteDate ? { due: note.noteDate } : {}), note: `메모 "${note.title || '제목 없음'}"에서 만든 할 일` })
    lines[i] = lines[i] + MARK
    count++
  }
  const body = lines.join('\n')
  if (count) await updateItem(note.id, { note: body })
  return { count, body }
}

/** 목록용 미리보기 한 줄 */
export const snippet = (body?: string) =>
  (body ?? '')
    .replace(/^#+\s*/gm, '')
    .replace(/^\s*[-*]\s*(\[[ x]\]\s*)?/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
