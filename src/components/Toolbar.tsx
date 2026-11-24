import { format, isSameMonth, isSameYear } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useUI } from '../store'
import type { View } from '../types'
import { weekDays } from '../lib/date'
import { Icon } from './ui'

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

export function Toolbar() {
  const { view, date, setView, shift, goToday, sidebarOpen, toggleSidebar, newEvent, isMobile, openImport } = useUI()
  const t = title(view, date)

  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-4 pb-3 md:px-6 md:pt-6">
      {(!sidebarOpen || isMobile) && (
        <button onClick={toggleSidebar} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="사이드바 열기">
          <Icon name={isMobile ? 'menu' : 'sidebar'} size={18} />
        </button>
      )}
      <div className="flex min-w-0 items-baseline gap-2.5">
        <h1 className="truncate text-[24px] leading-tight font-bold tracking-[-0.01em] md:text-[32px]">{t.main}</h1>
        <span className="text-[13px] whitespace-nowrap text-fg2 md:text-[14px]">{t.sub}</span>
      </div>

      <div className="ml-auto flex items-center gap-1.5">
        <button onClick={goToday} className="h-8 rounded-[6px] border border-line-strong px-3 text-[13px] hover:bg-hover" title="오늘 (.)">
          오늘
        </button>
        <div className="flex">
          <button onClick={() => shift(-1)} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="이전" title="이전 (←)">
            <Icon name="left" size={18} />
          </button>
          <button onClick={() => shift(1)} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="다음" title="다음 (→)">
            <Icon name="right" size={18} />
          </button>
        </div>
        <div className="flex rounded-[6px] bg-hover p-0.5" role="tablist">
          {VIEWS.map(({ v, label, key }) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              title={`${label} 보기 (${key})`}
              onClick={() => setView(v)}
              className={`h-7 rounded-[5px] px-3 text-[13px] transition-colors ${view === v ? 'bg-bg font-medium text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2 hover:text-fg'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => openImport()}
          className="ml-1 flex h-8 items-center gap-1.5 rounded-[6px] border border-line-strong px-2.5 text-[13px] hover:bg-hover"
          title="스크린샷·사진·파일에서 일정 가져오기 (I) — 캡처 후 Ctrl/⌘+V 도 돼요"
        >
          <Icon name="sparkle" size={15} className="text-accent" />
          <span className="hidden lg:inline">캡처로 추가</span>
        </button>
        <button
          onClick={() => newEvent()}
          className="flex h-8 items-center gap-1 rounded-[6px] bg-accent px-3 text-[13px] font-medium text-white hover:brightness-110"
          title="새 일정 (N)"
        >
          <Icon name="plus" size={15} />
          <span className="hidden sm:inline">새 일정</span>
        </button>
      </div>
    </header>
  )
}
