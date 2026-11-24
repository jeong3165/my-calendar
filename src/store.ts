import { addDays, addMonths, addWeeks, isSameDay } from 'date-fns'
import { create } from 'zustand'
import { createItem, db, deleteItem } from './db'
import type { Item, Section, View } from './types'

const mobileQuery = '(max-width: 767px)'
const isMobileNow = () => typeof window !== 'undefined' && window.matchMedia(mobileQuery).matches

type UI = {
  view: View
  date: Date
  selectedId: string | null
  draftId: string | null
  sidebarOpen: boolean
  paletteOpen: boolean
  section: Section
  quickAddTick: number
  isMobile: boolean

  setView: (v: View) => void
  setDate: (d: Date) => void
  shift: (dir: 1 | -1) => void
  goToday: () => void
  open: (id: string, draft?: boolean) => void
  close: () => void
  setSidebar: (open: boolean) => void
  toggleSidebar: () => void
  setPalette: (open: boolean) => void
  setSection: (s: Section) => void
  focusQuickAdd: () => void
  setMobile: (m: boolean) => void
  newEvent: (at?: Date) => Promise<Item>

  // 이미지·파일에서 일정 가져오기
  importOpen: boolean
  importSeed: { files: File[]; text: string; tick: number }
  settingsOpen: boolean
  settingsTab: 'ai' | 'sync'
  toast: string | null
  openImport: (files?: File[], text?: string) => void
  closeImport: () => void
  setSettings: (open: boolean, tab?: 'ai' | 'sync') => void
  showToast: (msg: string) => void
}

/** 새로 만든 뒤 아무것도 적지 않고 닫은 항목은 지운다 */
async function discardIfEmptyDraft(draftId: string | null) {
  if (!draftId) return
  const it = await db.items.get(draftId)
  if (it && !it.title.trim() && !it.note?.trim()) await deleteItem(draftId)
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

export const useUI = create<UI>((set, get) => ({
  view: isMobileNow() ? 'day' : 'week',
  date: new Date(),
  selectedId: null,
  draftId: null,
  sidebarOpen: !isMobileNow(),
  paletteOpen: false,
  section: { kind: 'today' },
  quickAddTick: 0,
  isMobile: isMobileNow(),

  setView: (view) => set({ view }),
  setDate: (date) => set({ date }),
  shift: (dir) => {
    const { view, date } = get()
    set({ date: view === 'month' ? addMonths(date, dir) : view === 'week' ? addWeeks(date, dir) : addDays(date, dir) })
  },
  goToday: () => set({ date: new Date() }),
  open: (id, draft = false) => {
    const { draftId, selectedId } = get()
    if (draftId && draftId !== id && draftId === selectedId) void discardIfEmptyDraft(draftId)
    set({ selectedId: id, draftId: draft ? id : null })
  },
  close: () => {
    const { draftId, selectedId } = get()
    if (draftId && draftId === selectedId) void discardIfEmptyDraft(draftId)
    set({ selectedId: null, draftId: null })
  },
  setSidebar: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setSection: (section) => set({ section }),
  focusQuickAdd: () => set((s) => ({ sidebarOpen: true, quickAddTick: s.quickAddTick + 1 })),
  setMobile: (isMobile) => set({ isMobile }),
  importOpen: false,
  importSeed: { files: [], text: '', tick: 0 },
  settingsOpen: false,
  settingsTab: 'ai',
  toast: null,
  openImport: (files = [], text = '') =>
    set((s) => ({ importOpen: true, paletteOpen: false, importSeed: { files, text, tick: s.importSeed.tick + 1 } })),
  closeImport: () => set({ importOpen: false }),
  setSettings: (settingsOpen, tab) => set((s) => ({ settingsOpen, settingsTab: tab ?? s.settingsTab })),
  showToast: (toast) => {
    set({ toast })
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => set({ toast: null }), 3500)
  },
  newEvent: async (at) => {
    let start: Date
    if (at) start = at
    else {
      const base = get().date
      const now = new Date()
      start = new Date(base)
      if (isSameDay(base, now)) start.setHours(Math.min(now.getHours() + 1, 23), 0, 0, 0)
      else start.setHours(9, 0, 0, 0)
    }
    const end = new Date(start.getTime() + 60 * 60000)
    const item = await createItem({ type: 'event', start: start.toISOString(), end: end.toISOString() })
    set({ date: start })
    get().open(item.id, true)
    return item
  },
}))

export { mobileQuery }
