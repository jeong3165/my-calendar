export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
export type NotionColor = (typeof COLORS)[number]

export type Priority = 'high' | 'normal' | 'low'

/**
 * 일정(event)과 할 일(task)을 하나의 모델로 관리한다.
 * 할 일에 start/end 가 생기면 그대로 캘린더의 "시간 블록"이 된다.
 *
 * - 시간 일정: start/end = 실제 시각(ISO)
 * - 종일 일정: allDay = true, start = 첫날 0시, end = 마지막날 0시 (마지막 날 포함)
 * - 할 일 마감일: due = 'YYYY-MM-DD'
 */
export type Item = {
  id: string
  type: 'event' | 'task'
  title: string
  start?: string
  end?: string
  allDay?: boolean
  due?: string
  done?: boolean
  priority?: Priority
  tags: string[]
  color: NotionColor
  note?: string
  createdAt: string
  updatedAt: string
}

export const COLOR_LABEL: Record<NotionColor, string> = {
  gray: '회색',
  brown: '갈색',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  blue: '파랑',
  purple: '보라',
  pink: '분홍',
  red: '빨강',
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: '높음',
  normal: '보통',
  low: '낮음',
}

export type View = 'month' | 'week' | 'day'

export type Section =
  | { kind: 'today' }
  | { kind: 'inbox' }
  | { kind: 'upcoming' }
  | { kind: 'done' }
  | { kind: 'tag'; tag: string }
