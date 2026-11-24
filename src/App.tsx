import { useEffect, useMemo, useState } from 'react'
import { mobileQuery, useUI } from './store'
import { weekDays } from './lib/date'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { MonthView } from './components/MonthView'
import { TimeGrid } from './components/TimeGrid'
import { PeekPanel } from './components/PeekPanel'
import { CommandPalette } from './components/CommandPalette'
import { TaskList } from './components/TaskList'
import { TableView } from './components/TableView'
import { BoardView } from './components/BoardView'
import { ImportDialog } from './components/ImportDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { Icon } from './components/ui'
import { SyncAgent } from './components/SyncAgent'
import { NotificationAgent } from './components/NotificationAgent'
import { ScopeDialog } from './components/ScopeDialog'

export default function App() {
  const { mode, view, date, selectedId, paletteOpen, isMobile, setMobile, importOpen, settingsOpen, toast, scopePrompt } = useUI()
  const [fileOver, setFileOver] = useState(false)

  // 화면 크기 감지
  useEffect(() => {
    const mq = window.matchMedia(mobileQuery)
    const on = () => {
      setMobile(mq.matches)
      if (mq.matches) useUI.setState({ sidebarOpen: false })
    }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
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
      if (ui.settingsOpen || ui.importOpen) {
        if (e.key === 'Escape') ui.settingsOpen ? ui.setSettings(false) : ui.closeImport()
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

  const days = useMemo(() => (view === 'week' ? weekDays(date) : [date]), [view, date])

  return (
    <div className="flex h-full">
      <SyncAgent />
      <NotificationAgent />
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col">
        <Toolbar />
        <div className="flex min-h-0 flex-1 border-t border-line">
          <div className="flex min-w-0 flex-1 flex-col">
            {mode === 'table' ? <TableView /> : mode === 'board' ? <BoardView /> : view === 'month' ? <MonthView /> : <TimeGrid days={days} />}
            {isMobile && mode === 'calendar' && (
              <section className="max-h-[38vh] shrink-0 overflow-y-auto border-t border-line bg-sidebar pt-2">
                <div className="px-3.5 pb-1 text-[12px] font-medium text-fg3">오늘 할 일</div>
                <TaskList section={{ kind: 'today' }} compact />
              </section>
            )}
          </div>
          {selectedId && <PeekPanel />}
        </div>
      </main>
      {paletteOpen && <CommandPalette />}
      {importOpen && <ImportDialog />}
      {settingsOpen && <SettingsDialog />}
      {scopePrompt && <ScopeDialog />}
      {fileOver && !importOpen && (
        <div className="pointer-events-none fixed inset-3 z-[90] grid place-items-center rounded-[16px] border-2 border-dashed border-accent bg-accent-soft backdrop-blur-[1px]">
          <div className="flex flex-col items-center gap-2 rounded-[12px] bg-popover px-6 py-4 shadow-pop">
            <Icon name="sparkle" size={24} className="text-accent" />
            <p className="text-[15px] font-medium">놓으면 일정을 찾아 드려요</p>
          </div>
        </div>
      )}
      {toast && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[95] -translate-x-1/2 rounded-[8px] bg-fg px-4 py-2 text-[14px] text-bg shadow-pop">
          {toast}
        </div>
      )}
    </div>
  )
}
