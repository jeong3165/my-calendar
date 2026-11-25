import { addDays, addMonths, addWeeks, isSameDay } from 'date-fns'
import { create } from 'zustand'
import { createItem, db, deleteItem } from './db'
import type { Item, Mode, Section, View } from './types'
import type { TemplatesView } from './components/TemplatesDialog'
import { DEFAULT_FILTERS, type Filters, type Sort } from './lib/filters'

export type Scope = 'this' | 'following' | 'all'
type SettingsTab = 'ai' | 'sync' | 'notify' | 'subs' | 'display'

const mobileQuery = '(max-width: 767px)'
const isMobileNow = () => typeof window !== 'undefined' && window.matchMedia(mobileQuery).matches

/* 보기 설정은 이 브라우저에 기억 (편의 기능, 실패해도 무방) */
const PREFS = 'my-calendar.view-prefs'
type Prefs = { mode: Mode; filters: Filters; sort: Sort; boardGroup: 'status' | 'priority' | 'project' }
function loadPrefs(): Partial<Prefs> {
  try {
    return JSON.parse(localStorage.getItem(PREFS) ?? '{}')
  } catch {
    return {}
  }
}
function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS, JSON.stringify(p))
  } catch {
    /* ignore */
  }
}
const prefs = loadPrefs()

type UI = {
  mode: Mode
  filters: Filters
  sort: Sort
  boardGroup: 'status' | 'priority' | 'project'
  setMode: (m: Mode) => void
  setFilters: (f: Partial<Filters>) => void
  resetFilters: () => void
  setSort: (s: Sort) => void
  setBoardGroup: (g: 'status' | 'priority' | 'project') => void
  daySub: 'plan' | 'review' | 'week'
  timerPanel: boolean
  assistantOpen: boolean
  templates: TemplatesView | null
  // 화면 크기 조절 (이 브라우저에 기억)
  sidebarW: number
  peekW: number
  uiScale: number
  hourH: number
  setLayout: (p: Partial<Layout>) => void
  projectId: string | null
  openProject: (id: string) => void
  dayDate: Date
  setDaySub: (s: 'plan' | 'review' | 'week') => void
  setDayDate: (d: Date) => void

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
  settingsTab: SettingsTab
  toast: string | null
  openImport: (files?: File[], text?: string) => void
  closeImport: () => void
  setSettings: (open: boolean, tab?: SettingsTab) => void

  // 반복 일정: 어디까지 바꿀지 묻기
  scopePrompt: { kind: 'change' | 'delete'; resolve: (s: Scope | null) => void } | null
  askScope: (kind: 'change' | 'delete') => Promise<Scope | null>
  showToast: (msg: string) => void
}

/** 새로 만든 뒤 아무것도 적지 않고 닫은 항목은 지운다 */
async function discardIfEmptyDraft(draftId: string | null) {
  if (!draftId) return
  const it = await db.items.get(draftId)
  if (it && !it.title.trim() && !it.note?.trim()) await deleteItem(draftId)
}

let toastTimer: ReturnType<typeof setTimeout> | undefined

type Layout = { sidebarW: number; peekW: number; uiScale: number; hourH: number }
const LAYOUT_KEY = 'my-calendar.layout'
export const LAYOUT_DEFAULT: Layout = { sidebarW: 280, peekW: 460, uiScale: 1, hourH: 48 }
function loadLayout(): Partial<Layout> {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export const useUI = create<UI>((set, get) => ({
  mode: prefs.mode === 'project' ? 'calendar' : (prefs.mode ?? 'calendar'),
  filters: { ...DEFAULT_FILTERS, ...prefs.filters },
  sort: prefs.sort ?? { key: 'date', dir: 'asc' },
  boardGroup: prefs.boardGroup ?? 'status',
  setMode: (mode) =>
    set((s) => ({
      mode,
      // 하루 탭을 열 때: 오후 3시 전이면 아침 계획, 그 뒤면 하루 정리
      ...(mode === 'day' && s.mode !== 'day' ? { daySub: new Date().getHours() < 15 ? 'plan' : 'review', dayDate: new Date() } : {}),
    })),
  daySub: new Date().getHours() < 15 ? 'plan' : 'review',
  dayDate: new Date(),
  timerPanel: false,
  assistantOpen: false,
  templates: null,
  ...LAYOUT_DEFAULT,
  ...loadLayout(),
  setLayout: (patch) => {
    set(patch)
    const { sidebarW, peekW, uiScale, hourH } = get()
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({ sidebarW, peekW, uiScale, hourH }))
    } catch {
      /* ignore */
    }
  },
  projectId: null,
  openProject: (projectId) => {
    const { draftId, selectedId } = get()
    if (draftId && draftId === selectedId) void discardIfEmptyDraft(draftId)
    set({ mode: 'project', projectId, selectedId: null, draftId: null, ...(isMobileNow() ? { sidebarOpen: false } : {}) })
  },
  setDaySub: (daySub) => set({ daySub }),
  setDayDate: (dayDate) => set({ dayDate }),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => set((s) => ({ filters: { ...DEFAULT_FILTERS, type: s.filters.type } })),
  setSort: (sort) => set({ sort }),
  setBoardGroup: (boardGroup) => set({ boardGroup }),

  view: isMobileNow() ? 'day' : 'week',
  date: new Date(),
  selectedId: null,
  draftId: null,
  sidebarOpen: !isMobileNow(),
  paletteOpen: false,
  section: { kind: 'today' },
  quickAddTick: 0,
  isMobile: isMobileNow(),

  setView: (view) => set({ view, mode: 'calendar' }),
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
    // 프로젝트면 상세 패널 대신 프로젝트 페이지로
    if (!id.includes('::'))
      void db.items.get(id).then((it) => {
        if (it?.type === 'project' && get().selectedId === id) get().openProject(id)
      })
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
  scopePrompt: null,
  askScope: (kind) =>
    new Promise((resolve) => {
      get().scopePrompt?.resolve(null)
      set({
        scopePrompt: {
          kind,
          resolve: (v) => {
            set({ scopePrompt: null })
            resolve(v)
          },
        },
      })
    }),
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

// 보기 설정이 바뀔 때마다 저장
useUI.subscribe((s, prev) => {
  if (s.mode !== prev.mode || s.filters !== prev.filters || s.sort !== prev.sort || s.boardGroup !== prev.boardGroup)
    savePrefs({ mode: s.mode, filters: s.filters, sort: s.sort, boardGroup: s.boardGroup })
})
