import { addDays, format, isSameMonth, isSameYear, startOfWeek } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useEffect, useState } from 'react'
import { useUI } from '../store'
import type { Mode, View } from '../types'
import { createItem } from '../db'
import { FilterBar } from './FilterBar'
import { fmtClock, remainingMs, useTimer } from '../lib/timer'
import { weekDays } from '../lib/date'
import { Icon, type IconName } from './ui'

const VIEWS: { v: View; label: string; key: string }[] = [
  { v: 'month', label: '월', key: 'M' },
  { v: 'week', label: '주', key: 'W' },
  { v: 'day', label: '일', key: 'D' },
]

function title(view: View, date: Date) {
  if (view === 'month') return { main: format(date, 'M월'), sub: format(date, 'yyyy년') }
  if (view === 'day') return { main: format(date, 'M월 d일'), sub: format(date, 'yyyy년 · EEEE', { locale: ko }) }
  const days = weekDays(date)
  const a = days[0]
  const b = days[6]
  if (isSameMonth(a, b)) return { main: format(a, 'M월'), sub: format(a, 'yyyy년') }
  return { main: `${format(a, 'M월')} – ${format(b, 'M월')}`, sub: isSameYear(a, b) ? format(a, 'yyyy년') : `${format(a, 'yyyy')}–${format(b, 'yyyy')}년` }
}

const MODES: { m: Mode; label: string; icon: IconName; key: string }[] = [
  { m: 'calendar', label: '캘린더', icon: 'calendar', key: 'M/W/D' },
  { m: 'table', label: '표', icon: 'table', key: 'L' },
  { m: 'board', label: '보드', icon: 'board', key: 'B' },
  { m: 'day', label: '하루', icon: 'sun', key: 'P' },
  { m: 'habits', label: '습관', icon: 'flame', key: 'H' },
  { m: 'chat', label: 'AI 채팅', icon: 'chat', key: 'C' },
]
const DAY_SUBS = [
  ['plan', '아침 계획'],
  ['review', '하루 정리'],
  ['week', '주간 리뷰'],
] as const

export function Toolbar() {
  const { mode, setMode, view, date, sidebarOpen, toggleSidebar, newEvent, isMobile, openImport, open, daySub, setDaySub, dayDate, setDayDate, screen } = useUI()
  const weekStart = startOfWeek(dayDate, { weekStartsOn: 1 })
  const t =
    mode === 'calendar'
      ? title(view, date)
      : mode === 'table'
        ? { main: '모든 항목', sub: '일정과 할 일을 표로' }
        : mode === 'tasks'
          ? { main: '할 일', sub: '' }
          : mode === 'habits'
          ? { main: '습관', sub: '반복 할 일의 연속 기록' }
          : mode === 'chat'
          ? { main: 'AI 채팅', sub: '웹 검색 · 내 일정 확인·추가' }
          : mode === 'project'
          ? { main: '프로젝트', sub: '할 일을 묶어서 관리' }
          : mode === 'board'
          ? { main: '할 일 보드', sub: '끌어다 놓아 상태 바꾸기' }
          : daySub === 'plan'
            ? { main: '아침 계획', sub: format(new Date(), 'M월 d일 EEEE', { locale: ko }) }
            : daySub === 'review'
              ? { main: '하루 정리', sub: format(dayDate, 'yyyy년 M월 d일 EEEE', { locale: ko }) }
              : { main: '주간 리뷰', sub: `${format(weekStart, 'M월 d일')} – ${format(addDays(weekStart, 6), 'M월 d일')}` }
  const dayStep = (dir: 1 | -1) => setDayDate(addDays(dayDate, daySub === 'week' ? 7 * dir : dir))

  async function newTask() {
    const it = await createItem({ type: 'task' })
    open(it.id, true)
  }

  return (
    <header className={isMobile ? 'flex flex-col gap-1.5 border-b border-line px-2 pt-[max(6px,env(safe-area-inset-top))] pb-1.5' : 'flex flex-col gap-2 px-4 pt-4 pb-2 md:px-6 md:pt-6'}>
      <div className={isMobile ? 'flex items-center gap-1' : 'flex flex-wrap items-center gap-x-3 gap-y-2'}>
        {(!sidebarOpen || isMobile || screen !== 'desktop') && (
          <button onClick={toggleSidebar} className={`grid place-items-center rounded-[6px] text-fg2 hover:bg-hover ${isMobile ? 'h-9 w-9' : 'h-8 w-8'}`} aria-label="사이드바 열기">
            <Icon name={screen === 'desktop' ? 'sidebar' : 'menu'} size={isMobile ? 20 : 18} />
          </button>
        )}
        <div className={`flex min-w-0 items-baseline gap-2.5 ${isMobile ? 'flex-1' : ''}`}>
          <h1 className={`truncate leading-tight font-bold tracking-[-0.01em] ${isMobile ? 'text-[19px]' : 'text-[24px] md:text-[32px]'}`}>{t.main}</h1>
          {!isMobile && <span className="hidden text-[13px] whitespace-nowrap text-fg2 sm:inline md:text-[14px]">{t.sub}</span>}
        </div>
        {isMobile && mode === 'calendar' && <CalNav compact />}
        <div className={`ml-auto flex items-center gap-1.5 ${isMobile ? 'hidden' : ''}`}>
          <TimerButton />
          <button
            onClick={() => useUI.setState({ assistantOpen: true })}
            className="flex h-8 items-center gap-1.5 rounded-[6px] border border-line-strong px-2.5 text-[13px] hover:bg-hover"
            title="AI 일정 비서 (A) — 말로 부탁하면 빈 시간에 배치해 드려요"
          >
            <Icon name="sparkle" size={15} className="text-[var(--c-purple-bar)]" />
            <span className="hidden lg:inline">AI 비서</span>
          </button>
          <button
            onClick={() => openImport()}
            className="flex h-8 items-center gap-1.5 rounded-[6px] border border-line-strong px-2.5 text-[13px] hover:bg-hover"
            title="스크린샷·사진·파일에서 일정 가져오기 (I) — 캡처 후 Ctrl/⌘+V 도 돼요"
          >
            <Icon name="image" size={15} className="text-accent" />
            <span className="hidden lg:inline">캡처로 추가</span>
          </button>
          {!isMobile && <button
            onClick={() => (mode === 'calendar' ? newEvent() : newTask())}
            className="flex h-8 items-center gap-1 rounded-[6px] bg-accent px-3 text-[13px] font-medium text-white hover:brightness-110"
            title={mode === 'calendar' ? '새 일정 (N)' : '새 할 일'}
          >
            <Icon name="plus" size={15} />
            <span className="hidden sm:inline">{mode === 'calendar' ? '새 일정' : '새 할 일'}</span>
          </button>}
        </div>
      </div>

      {/* 노션식 보기 탭 + 보기별 도구 (휴대폰에서 캘린더는 위 한 줄에 다 들어감) */}
      {isMobile && <TimerButton />}
      {!(isMobile && ['calendar', 'project', 'habits', 'tasks', 'chat'].includes(mode)) && (
      <div className={isMobile ? 'flex flex-wrap items-center gap-1.5 [&_button]:text-[12px]' : 'flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line pb-1.5'}>
        <div className={`gap-0.5 ${isMobile ? 'hidden' : 'flex'}`} role="tablist" aria-label="보기">
          {MODES.map(({ m, label, icon, key }) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              title={`${label} 보기 (${key})`}
              onClick={() => setMode(m)}
              className={`flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[14px] ${mode === m ? 'bg-active font-medium text-fg' : 'text-fg2 hover:bg-hover'}`}
            >
              <Icon name={icon} size={15} />
              {label}
            </button>
          ))}
        </div>

        <div className={isMobile ? 'flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-x-auto' : 'ml-auto flex flex-wrap items-center gap-1.5'}>
          {mode === 'calendar' ? (
            <CalNav />
          ) : mode === 'project' || mode === 'habits' || mode === 'tasks' || mode === 'chat' ? null : mode === 'day' ? (
            <>
              {daySub !== 'plan' && (
                <>
                  <button onClick={() => setDayDate(new Date())} className="h-7 rounded-[6px] border border-line-strong px-2.5 text-[13px] hover:bg-hover">
                    {daySub === 'week' ? '이번 주' : '오늘'}
                  </button>
                  <div className="flex">
                    <button onClick={() => dayStep(-1)} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="이전">
                      <Icon name="left" size={17} />
                    </button>
                    <button onClick={() => dayStep(1)} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="다음">
                      <Icon name="right" size={17} />
                    </button>
                  </div>
                </>
              )}
              <div className="flex rounded-[6px] bg-hover p-0.5" role="tablist" aria-label="하루 보기">
                {DAY_SUBS.map(([k, l]) => (
                  <button
                    key={k}
                    role="tab"
                    aria-selected={daySub === k}
                    onClick={() => setDaySub(k)}
                    className={`h-6 rounded-[5px] px-2.5 text-[13px] ${daySub === k ? 'bg-bg font-medium text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2 hover:text-fg'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <FilterBar />
          )}
        </div>
      </div>
      )}
    </header>
  )
}

/** 툴바의 ⏱ 버튼: 쉬는 중이면 빠른 시작 창, 도는 중이면 남은 시간 */
function TimerButton() {
  const t = useTimer()
  const active = t.phase !== 'idle'
  const isMobile = useUI((s) => s.isMobile)
  const [, force] = useState(0)
  useEffect(() => {
    if (!active || !t.running) return
    const id = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [active, t.running])
  if (isMobile && !active) return null // 휴대폰에서는 돌 때만
  return (
    <button
      onClick={() => useUI.setState((s) => ({ timerPanel: !s.timerPanel }))}
      className={`tnum flex h-8 items-center gap-1.5 rounded-[6px] border px-2.5 text-[13px] hover:bg-hover ${active ? 'border-danger/40 font-medium text-danger' : 'border-line-strong'}`}
      title="집중 타이머 (F)"
    >
      <Icon name="clock" size={15} />
      {active ? fmtClock(remainingMs(t)) : <span className="hidden lg:inline">집중</span>}
    </button>
  )
}

/** 캘린더 이동: 오늘 · ‹ › · 월/주/일 (compact = 휴대폰 한 줄용) */
function CalNav({ compact = false }: { compact?: boolean }) {
  const { view, setView, shift, goToday } = useUI()
  const h = compact ? 'h-8' : 'h-7'
  return (
    <div className={`flex items-center ${compact ? 'gap-0.5' : 'gap-1.5'}`}>
      {!compact && (
        <button onClick={goToday} className={`${h} rounded-[6px] border border-line-strong px-2.5 text-[13px] hover:bg-hover`} title="오늘 (.)">
          오늘
        </button>
      )}
      <div className="flex items-center">
        <button onClick={() => shift(-1)} className={`grid ${h} w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover`} aria-label="이전" title="이전 (←)">
          <Icon name="left" size={17} />
        </button>
        {compact && (
          <button onClick={goToday} className={`${h} rounded-[6px] px-1.5 text-[13px] font-medium text-accent`} title="오늘">
            오늘
          </button>
        )}
        <button onClick={() => shift(1)} className={`grid ${h} w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover`} aria-label="다음" title="다음 (→)">
          <Icon name="right" size={17} />
        </button>
      </div>
      <div className="flex rounded-[6px] bg-hover p-0.5" role="tablist" aria-label="캘린더 범위">
        {VIEWS.map(({ v, label, key }) => (
          <button
            key={v}
            role="tab"
            aria-selected={view === v}
            title={`${label} 보기 (${key})`}
            onClick={() => setView(v)}
            className={`rounded-[5px] text-[13px] transition-colors ${compact ? 'h-7 px-2' : 'h-6 px-2.5'} ${view === v ? 'bg-bg font-medium text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2 hover:text-fg'}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
