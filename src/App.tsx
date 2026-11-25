import { useEffect, useMemo, useRef, useState } from 'react'
import { mobileQuery, screenNow, useUI } from './store'
import { weekDays } from './lib/date'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { MonthView } from './components/MonthView'
import { TimeGrid } from './components/TimeGrid'
import { PeekPanel } from './components/PeekPanel'
import { CommandPalette } from './components/CommandPalette'
import { TableView } from './components/TableView'
import { BoardView } from './components/BoardView'
import { DayView } from './components/DayView'
import { ProjectView } from './components/ProjectView'
import { HabitsView } from './components/HabitsView'
import { ChatView } from './components/ChatView'
import { ImportDialog } from './components/ImportDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { Icon } from './components/ui'
import { SyncAgent } from './components/SyncAgent'
import { SubsAgent } from './components/SubsAgent'
import { TimerWidget } from './components/TimerWidget'
import { AssistantDialog } from './components/AssistantDialog'
import { TemplatesDialog } from './components/TemplatesDialog'
import { BottomNav, Fab, MobileTasksView, QuickAddSheet } from './components/Mobile'
import { gesture } from './components/TimeGrid'
import { startFocus, toggle as toggleTimer, useTimer } from './lib/timer'
import { resolveItem } from './lib/recur'
import { db } from './db'
import { NotificationAgent } from './components/NotificationAgent'
import { ScopeDialog } from './components/ScopeDialog'

export default function App() {
  const { mode, view, date, selectedId, paletteOpen, isMobile, setMobile, importOpen, settingsOpen, toast, scopePrompt, assistantOpen, templates, quickAddOpen, sidebarOpen } = useUI()
  const [fileOver, setFileOver] = useState(false)

  // 화면 크기 감지
  useEffect(() => {
    const mq = window.matchMedia(mobileQuery)
    const on = () => {
      setMobile(mq.matches)
      const prev = useUI.getState().screen
      const screen = screenNow()
      if (screen === prev) return
      // 넓은 화면으로 바뀌면 사이드바를 펼치고, 좁아지면 접는다
      useUI.setState({ screen, sidebarOpen: screen === 'desktop' })
    }
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [setMobile])

  // 전역 단축키 (한글 자판에서도 동작하도록 e.code 사용)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ui = useUI.getState()
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.code === 'KeyK') {
        e.preventDefault()
        ui.setPalette(!ui.paletteOpen)
        return
      }
      if (mod && e.code === 'Backslash') {
        e.preventDefault()
        ui.toggleSidebar()
        return
      }
      if (ui.scopePrompt) {
        if (e.key === 'Escape') ui.scopePrompt.resolve(null)
        return
      }
      if (ui.settingsOpen || ui.importOpen || ui.assistantOpen || ui.templates) {
        if (e.key === 'Escape') ui.settingsOpen ? ui.setSettings(false) : ui.importOpen ? ui.closeImport() : useUI.setState({ assistantOpen: false, templates: null })
        return
      }
      if (e.key === 'Escape') {
        if (ui.paletteOpen) ui.setPalette(false)
        else if (ui.selectedId) {
          ;(document.activeElement as HTMLElement | null)?.blur()
          ui.close()
        } else if (ui.isMobile && ui.sidebarOpen) ui.setSidebar(false)
        return
      }
      const t = e.target as HTMLElement
      if (mod || e.altKey || e.isComposing || ui.paletteOpen || t.closest('input, textarea, select, [contenteditable="true"]')) return
      const map: Record<string, () => void> = {
        KeyN: () => void ui.newEvent(),
        KeyT: () => ui.focusQuickAdd(),
        KeyM: () => ui.setView('month'),
        KeyW: () => ui.setView('week'),
        KeyD: () => ui.setView('day'),
        ArrowLeft: () => ui.mode === 'calendar' && ui.shift(-1),
        ArrowRight: () => ui.mode === 'calendar' && ui.shift(1),
        Period: () => (ui.setMode('calendar'), ui.goToday()),
        KeyI: () => ui.openImport(),
        KeyL: () => ui.setMode('table'),
        KeyB: () => ui.setMode('board'),
        KeyP: () => ui.setMode('day'),
        KeyA: () => useUI.setState({ assistantOpen: true }),
        KeyH: () => ui.setMode('habits'),
        KeyC: () => ui.setMode('chat'),
        KeyF: () => {
          if (useTimer.getState().phase !== 'idle') return toggleTimer()
          const sel = ui.selectedId
          if (!sel) return void startFocus()
          void db.items.toArray().then((all) => startFocus(resolveItem(all, sel)))
        },
      }
      const fn = map[e.code]
      if (fn) {
        e.preventDefault()
        fn()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 캡처한 이미지를 Ctrl/⌘+V → 가져오기 창으로
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = [...(e.clipboardData?.files ?? [])]
      const t = e.target as HTMLElement
      const typing = t.closest?.('input, textarea, [contenteditable="true"]')
      if (files.length) {
        e.preventDefault()
        useUI.getState().openImport(files)
      } else if (!typing && useUI.getState().importOpen === false) {
        const text = e.clipboardData?.getData('text/plain') ?? ''
        if (text.trim().length > 3) useUI.getState().openImport([], text)
      }
    }
    // 바탕화면 등에서 파일을 끌어다 놓기 (앱 내부 할 일 드래그와 구분)
    let depth = 0
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
    function onEnter(e: DragEvent) {
      if (!hasFiles(e)) return
      depth++
      setFileOver(true)
    }
    function onLeave(e: DragEvent) {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setFileOver(false)
    }
    function onOver(e: DragEvent) {
      if (hasFiles(e)) e.preventDefault()
    }
    function onDrop(e: DragEvent) {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setFileOver(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      if (files.length) useUI.getState().openImport(files)
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [])

  // 휴대폰: 캘린더를 좌우로 쓸어서 이전/다음 (길게 눌러 끄는 중이면 무시)
  const touch = useRef<{ x: number; y: number; t: number } | null>(null)
  const swipe = {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0]
      touch.current = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, t: Date.now() } : null
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s = touch.current
      touch.current = null
      if (!s || gesture.dragging) return
      const t = e.changedTouches[0]
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - s.t < 600) useUI.getState().shift(dx < 0 ? 1 : -1)
    },
  }

  // 휴대폰 뒤로가기 버튼으로 열린 창·상세 화면 닫기
  const overlay = isMobile && !!(selectedId || paletteOpen || importOpen || settingsOpen || assistantOpen || templates || quickAddOpen || sidebarOpen || scopePrompt)
  const pushed = useRef(false)
  const skipPop = useRef(false)
  useEffect(() => {
    if (overlay && !pushed.current) {
      history.pushState({ overlay: true }, '')
      pushed.current = true
    } else if (!overlay && pushed.current) {
      pushed.current = false
      skipPop.current = true
      history.back()
    }
  }, [overlay])
  useEffect(() => {
    const onPop = () => {
      if (skipPop.current) return void (skipPop.current = false)
      if (!pushed.current) return
      pushed.current = false
      const ui = useUI.getState()
      if (ui.scopePrompt) ui.scopePrompt.resolve(null)
      else if (ui.templates) useUI.setState({ templates: null })
      else if (ui.assistantOpen) useUI.setState({ assistantOpen: false })
      else if (ui.importOpen) ui.closeImport()
      else if (ui.settingsOpen) ui.setSettings(false)
      else if (ui.paletteOpen) ui.setPalette(false)
      else if (ui.quickAddOpen) useUI.setState({ quickAddOpen: false })
      else if (ui.selectedId) ui.close()
      else if (ui.sidebarOpen) ui.setSidebar(false)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const uiScale = useUI((s) => s.uiScale)
  useEffect(() => {
    const root = document.getElementById('root')
    if (root) root.style.zoom = uiScale === 1 ? '' : String(uiScale)
  }, [uiScale])

  const days = useMemo(() => (view === 'week' ? weekDays(date) : [date]), [view, date])

  return (
    <div className="flex h-full">
      <SyncAgent />
      <SubsAgent />
      <NotificationAgent />
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Toolbar />
        <div className="flex min-h-0 flex-1 border-t border-line">
          <div className="flex min-w-0 flex-1 flex-col" {...(isMobile && mode === 'calendar' ? swipe : {})}>
            {mode === 'tasks' ? <MobileTasksView /> : mode === 'habits' ? <HabitsView /> : mode === 'chat' ? <ChatView /> : mode === 'project' ? <ProjectView /> : mode === 'day' ? <DayView /> : mode === 'table' ? <TableView /> : mode === 'board' ? <BoardView /> : view === 'month' ? <MonthView /> : <TimeGrid days={days} />}
          </div>
          {selectedId && <PeekPanel />}
        </div>
        {isMobile && <BottomNav />}
      </main>
      {isMobile && !selectedId && mode !== 'chat' && <Fab />}
      {quickAddOpen && <QuickAddSheet />}
      {paletteOpen && <CommandPalette />}
      {importOpen && <ImportDialog />}
      {assistantOpen && <AssistantDialog />}
      {templates && <TemplatesDialog />}
      {settingsOpen && <SettingsDialog />}
      {scopePrompt && <ScopeDialog />}
      <TimerWidget />
      {fileOver && !importOpen && (
        <div className="pointer-events-none fixed inset-3 z-[90] grid place-items-center rounded-[16px] border-2 border-dashed border-accent bg-accent-soft backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 rounded-[12px] bg-popover px-6 py-4 shadow-pop">
            <Icon name="sparkle" size={24} className="text-accent" />
            <p className="text-[15px] font-medium">놓으면 일정을 찾아 드려요</p>
          </div>
        </div>
      )}
      {toast && (
        <div role="status" className={`fixed left-1/2 z-[95] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-[8px] bg-fg px-4 py-2 text-[14px] text-bg shadow-pop ${isMobile ? 'bottom-[calc(124px+env(safe-area-inset-bottom))]' : 'bottom-6'}`}>
          {toast}
        </div>
      )}
    </div>
  )
}
