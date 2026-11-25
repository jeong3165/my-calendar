import { useMemo, useState, type KeyboardEvent } from 'react'
import { createItem, exportJSON, updateItem, useItems } from '../db'
import { useUI } from '../store'
import { startFocus } from '../lib/timer'
import type { Item } from '../types'
import { hm, parseYmd, relDay, ymd } from '../lib/date'
import { taskKey } from '../lib/items'
import { parseQuick, parsedToItem } from '../lib/parse'
import { withProject } from '../lib/projects'
import { repeatLabel } from '../lib/recur'
import { Icon, Kbd, type IconName } from './ui'

type Cmd = { id: string; icon: IconName; label: string; hint?: string; run: () => void | Promise<void> }

export function CommandPalette() {
  const ui = useUI()
  const items = useItems()
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const close = () => ui.setPalette(false)

  const results = useMemo<Cmd[]>(() => {
    const query = q.trim()
    const out: Cmd[] = []
    if (query) {
      const p = parseQuick(query)
      const rep = p.repeat ? ` · ↻ ${repeatLabel(p.repeat, p.date ? ymd(p.date) : undefined)}` : ''
      const when = p.date ? ` · ${relDay(ymd(p.date))}${p.start ? ` ${String(p.start.h).padStart(2, '0')}:${String(p.start.m).padStart(2, '0')}` : ''}` : ''
      if (p.title) {
        out.push({
          id: 'new-event-q',
          icon: 'calendar',
          label: `새 일정: “${p.title}”${when}${rep}`,
          run: async () => {
            const it = await createItem({ type: 'event', ...(await withProject(parsedToItem(p, 'event'), p.project)) })
            if (it.start) ui.setDate(new Date(it.start))
            else {
              // 날짜가 없으면 오늘 다음 정시 1시간 일정
              const s = new Date()
              s.setHours(Math.min(s.getHours() + 1, 23), 0, 0, 0)
              await updateItem(it.id, { start: s.toISOString(), end: new Date(s.getTime() + 3600000).toISOString() })
            }
            ui.open(it.id)
          },
        })
        out.push({
          id: 'new-task-q',
          icon: 'done',
          label: `새 할 일: “${p.title}”${when}${rep}`,
          run: async () => {
            const it = await createItem({ type: 'task', ...(await withProject(parsedToItem(p, 'task'), p.project)) })
            ui.open(it.id)
          },
        })
      }
    }
    const lc = query.toLowerCase()
    const cmds: Cmd[] = [
      { id: 'new-event', icon: 'calendar', label: '새 일정', hint: 'N', run: () => void ui.newEvent() },
      { id: 'new-task', icon: 'plus', label: '새 할 일', hint: 'T', run: () => ui.focusQuickAdd() },
      { id: 'import', icon: 'sparkle', label: '스크린샷·사진·파일에서 일정 가져오기', hint: 'I', run: () => ui.openImport() },
      { id: 'ai-settings', icon: 'settings', label: 'AI 설정 (API 키)', run: () => ui.setSettings(true, 'ai') },
      { id: 'subs', icon: 'calendar', label: '구독 캘린더 (다른 캘린더 함께 보기)', run: () => ui.setSettings(true, 'subs') },
      { id: 'notify', icon: 'bell', label: '알림 설정', run: () => ui.setSettings(true, 'notify') },
      { id: 'sync', icon: 'upload', label: 'GitHub 동기화 설정 / 지금 동기화', run: () => ui.setSettings(true, 'sync') },
      { id: 'today', icon: 'sun', label: '오늘로 이동', hint: '.', run: () => ui.goToday() },
      { id: 'display', icon: 'settings', label: '화면 크기 조절 (글자·시간 칸·패널 너비)', run: () => ui.setSettings(true, 'display') },
      { id: 'templates', icon: 'checklist', label: '템플릿에서 추가 / 템플릿 관리', run: () => useUI.setState({ templates: { view: 'list' } }) },
      { id: 'habits', icon: 'flame', label: '습관 기록 보기', hint: 'H', run: () => ui.setMode('habits') },
      { id: 'voice', icon: 'mic', label: '말로 추가 (음성 입력)', run: () => useUI.setState({ quickAddOpen: true, quickAddVoice: true }) },
      { id: 'report', icon: 'chart', label: '월간 리포트 보기', run: () => (ui.setMode('day'), ui.setDaySub('month')) },
      { id: 'dday', icon: 'calendar', label: '기념일·D-day 추가', run: () => useUI.setState({ ddayEdit: 'new' }) },
      { id: 'export', icon: 'download', label: '엑셀(CSV)로 내보내기 / 백업', run: () => useUI.setState({ exportOpen: true }) },
      { id: 'briefing', icon: 'sun', label: '아침 브리핑 보기', run: () => useUI.setState({ briefingOpen: true }) },
      { id: 'chat', icon: 'chat', label: 'AI 채팅 (웹 검색·질문)', hint: 'C', run: () => ui.setMode('chat') },
      { id: 'assistant', icon: 'sparkle', label: 'AI 일정 비서에게 부탁하기', hint: 'A', run: () => useUI.setState({ assistantOpen: true }) },
      { id: 'focus', icon: 'clock', label: '집중 타이머 시작', hint: 'F', run: () => void startFocus() },
      { id: 'timer', icon: 'clock', label: '집중 타이머 창 열기 / 설정', run: () => useUI.setState({ timerPanel: true }) },
      { id: 'plan', icon: 'sun', label: '오늘 계획 세우기', hint: 'P', run: () => (ui.setMode('day'), ui.setDaySub('plan')) },
      { id: 'review', icon: 'done', label: '하루 정리 (회고)', run: () => (ui.setMode('day'), ui.setDaySub('review'), ui.setDayDate(new Date())) },
      { id: 'weekly', icon: 'calendar', label: '주간 리뷰', run: () => (ui.setMode('day'), ui.setDaySub('week'), ui.setDayDate(new Date())) },
      { id: 'table', icon: 'table', label: '표 보기', hint: 'L', run: () => ui.setMode('table') },
      { id: 'board', icon: 'board', label: '보드 보기', hint: 'B', run: () => ui.setMode('board') },
      { id: 'month', icon: 'type', label: '월 보기', hint: 'M', run: () => ui.setView('month') },
      { id: 'week', icon: 'type', label: '주 보기', hint: 'W', run: () => ui.setView('week') },
      { id: 'day', icon: 'type', label: '일 보기', hint: 'D', run: () => ui.setView('day') },
      { id: 'sidebar', icon: 'sidebar', label: '사이드바 열기/닫기', run: () => ui.toggleSidebar() },
      { id: 'export', icon: 'download', label: '데이터 내보내기 (JSON 백업)', run: () => exportJSON() },
    ]
    out.push(...(query ? cmds.filter((c) => c.label.toLowerCase().includes(lc)) : cmds))

    if (query) {
      const found = items
        .filter((it) => it.type !== 'template' && it.type !== 'dday')
        .filter((it) => it.title.toLowerCase().includes(lc) || it.tags.some((t) => t.toLowerCase().includes(lc.replace(/^#/, ''))) || it.note?.toLowerCase().includes(lc))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 8)
      out.push(...found.map((it) => itemCmd(it)))
    }
    return out

    function itemCmd(it: Item): Cmd {
      const key = it.type === 'task' ? taskKey(it) : it.start ? ymd(new Date(it.start)) : undefined
      return {
        id: it.id,
        icon: it.type === 'task' ? 'done' : 'calendar',
        label: it.title || '제목 없음',
        hint: key ? `${relDay(key)}${it.start && !it.allDay ? ` ${hm(new Date(it.start))}` : ''}` : undefined,
        run: () => {
          if (key) ui.setDate(it.start ? new Date(it.start) : parseYmd(key))
          ui.open(it.id)
        },
      }
    }
  }, [q, items, ui])

  const sel = Math.min(idx, Math.max(results.length - 1, 0))

  function onKey(e: KeyboardEvent) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIdx((sel + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIdx((sel - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = results[sel]
      if (c) {
        close()
        void c.run()
      }
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/25 px-4 pt-[12vh]" onMouseDown={close}>
      <div className="shadow-pop w-full max-w-[580px] overflow-hidden rounded-[10px] bg-popover" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="커맨드 팔레트">
        <div className="flex items-center gap-2.5 border-b border-line px-4">
          <Icon name="search" size={18} className="text-fg3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setIdx(0)
            }}
            onKeyDown={onKey}
            placeholder="검색하거나 새로 만들기… (예: 금요일 7시 저녁 약속)"
            className="h-12 flex-1 bg-transparent text-[16px] outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto py-1.5">
          {results.length === 0 && <li className="px-4 py-3 text-[14px] text-fg3">결과가 없어요.</li>}
          {results.map((c, i) => (
            <li key={c.id}>
              <button
                onMouseEnter={() => setIdx(i)}
                onClick={() => {
                  close()
                  void c.run()
                }}
                className={`mx-1.5 flex w-[calc(100%-12px)] items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[14px] ${i === sel ? 'bg-hover' : ''}`}
              >
                <Icon name={c.icon} size={16} className="text-fg2" />
                <span className="min-w-0 flex-1 truncate">{c.label}</span>
                {c.hint && <span className="tnum shrink-0 text-[12px] text-fg3">{c.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
