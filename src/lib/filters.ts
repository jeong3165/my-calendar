// 의존성 없는 설정 타입 (store 와 dbview 가 같이 쓴다)
import type { Priority } from '../types'

/* ───────── 필터 (표·보드 공통) ───────── */
export type Period = 'all' | 'today' | 'week' | 'month' | 'overdue' | 'none'
export type Filters = {
  q: string
  type: 'all' | 'event' | 'task'
  tags: string[]
  priorities: Priority[]
  period: Period
  hideDone: boolean
}
export const DEFAULT_FILTERS: Filters = { q: '', type: 'all', tags: [], priorities: [], period: 'all', hideDone: false }

export const PERIOD_LABEL: Record<Period, string> = {
  all: '전체 기간',
  today: '오늘',
  week: '이번 주',
  month: '이번 달',
  overdue: '지난 항목',
  none: '날짜 없음',
}

export type SortKey = 'title' | 'type' | 'date' | 'status' | 'priority' | 'tags' | 'updated'
export type Sort = { key: SortKey; dir: 'asc' | 'desc' }
