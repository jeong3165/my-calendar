export const COLORS = ['gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const
export type NotionColor = (typeof COLORS)[number]

export type Priority = 'high' | 'normal' | 'low'

/** 반복 규칙 (RRULE 의 일부를 단순화) */
export type Repeat = {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly'
  interval: number // n일/주/개월/년마다
  byDay?: number[] // 매주: 0=월 … 6=일
  monthly?: 'day' | 'nth' // 매월: 같은 날짜 / n번째 요일
  nth?: number // monthly='nth' 일 때 1~4 번째, -1 = 마지막 (없으면 기준일로 계산)
  until?: string // YYYY-MM-DD (포함)
  count?: number // 총 횟수
}

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
  doing?: boolean // 할 일: 진행 중 (보드의 가운데 칸)
  doneAt?: string // 할 일을 완료한 시각 (하루 정리용)
  priority?: Priority
  tags: string[]
  color: NotionColor
  note?: string
  repeat?: Repeat
  exdates?: string[] // 반복에서 빠진 날짜 (YYYY-MM-DD)
  doneDates?: string[] // 반복 할 일: 완료한 회차 날짜
  remind?: number[] // 알림: 시작 몇 분 전 (종일은 0시 기준, 음수 = 그날 이후)
  /** 화면용 반복 회차 정보 (저장하지 않음) */
  occ?: { seriesId: string; date: string }
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
export type Mode = 'calendar' | 'table' | 'board' | 'day'
export type Status = 'todo' | 'doing' | 'done'
export const STATUS_LABEL: Record<Status, string> = { todo: '할 일', doing: '진행 중', done: '완료' }

export type Section =
  | { kind: 'today' }
  | { kind: 'inbox' }
  | { kind: 'upcoming' }
  | { kind: 'done' }
  | { kind: 'tag'; tag: string }

/** 하루 기록 (아침 계획 + 저녁 회고). 주간 회고는 key 가 'week:YYYY-MM-DD'(월요일) */
export type Journal = {
  date: string
  planned?: string[] // 아침에 계획한 항목 id (반복 회차는 'id::날짜')
  plannedAt?: string
  plannedMinutes?: number // 계획한 시간 블록 합 (분)
  mood?: number // 1~5
  note?: string // 한 줄 회고
  good?: string // 잘한 점
  better?: string // 아쉬운 점
  updatedAt: string
}
