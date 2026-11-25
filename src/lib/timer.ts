import { create } from 'zustand'
import { addSession } from '../db'
import type { Item } from '../types'
import { ymd } from './date'
import { loadNotify, showSystemNotification } from './notify'

/* ───────── 설정 ───────── */
export type TimerSettings = {
  focus: number // 분
  shortBreak: number
  longBreak: number
  longEvery: number // n번 집중마다 긴 휴식
  autoBreak: boolean // 집중이 끝나면 휴식 자동 시작
  sound: boolean
}
const SKEY = 'my-calendar.timer-settings'
const DEFAULTS: TimerSettings = { focus: 25, shortBreak: 5, longBreak: 15, longEvery: 4, autoBreak: true, sound: true }

export function loadTimerSettings(): TimerSettings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SKEY) ?? '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}
export function saveTimerSettings(s: TimerSettings) {
  try {
    localStorage.setItem(SKEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/* ───────── 상태 (새로고침해도 이어지도록 저장) ───────── */
export type Phase = 'idle' | 'focus' | 'break'
export type TimerState = {
  phase: Phase
  running: boolean
  itemId?: string
  title: string
  plannedMs: number
  accumulated: number // 멈추기 전까지 흐른 시간
  runStartedAt: number | null // 지금 구간 시작 시각 (멈춤이면 null)
  sessionStart: string | null // 이번 집중을 처음 시작한 시각
  count: number // 오늘 끝낸 집중 횟수 (긴 휴식 계산용)
  countDate: string
  justFinished?: { itemId?: string; title: string; minutes: number } // "완료로 표시할까요?" 안내용
}
const TKEY = 'my-calendar.timer-state'
const IDLE: TimerState = { phase: 'idle', running: false, title: '', plannedMs: 0, accumulated: 0, runStartedAt: null, sessionStart: null, count: 0, countDate: '' }

function loadState(): TimerState {
  try {
    const s = { ...IDLE, ...JSON.parse(localStorage.getItem(TKEY) ?? '{}') } as TimerState
    if (s.countDate !== ymd(new Date())) s.count = 0
    return s
  } catch {
    return IDLE
  }
}

export const useTimer = create<TimerState>(() => loadState())
useTimer.subscribe((s) => {
  try {
    localStorage.setItem(TKEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
})
// 다른 탭에서 바꾸면 이 탭도 따라간다
if (typeof window !== 'undefined')
  window.addEventListener('storage', (e) => {
    if (e.key === TKEY && e.newValue) useTimer.setState(JSON.parse(e.newValue))
  })

export const elapsedMs = (s: TimerState, now = Date.now()) => s.accumulated + (s.running && s.runStartedAt ? now - s.runStartedAt : 0)
export const remainingMs = (s: TimerState, now = Date.now()) => Math.max(0, s.plannedMs - elapsedMs(s, now))

export function fmtClock(ms: number) {
  const t = Math.ceil(ms / 1000)
  const m = Math.floor(t / 60)
  const s = t % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/* ───────── 소리 ───────── */
let ctx: AudioContext | null = null
function audio() {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null
  }
}
/** 부드러운 3음 알림 */
export function chime(kind: 'focus' | 'break') {
  if (!loadTimerSettings().sound) return
  const a = audio()
  if (!a) return
  const notes = kind === 'focus' ? [660, 880, 1100] : [880, 660, 520]
  notes.forEach((f, i) => {
    const o = a.createOscillator()
    const g = a.createGain()
    o.type = 'sine'
    o.frequency.value = f
    const t = a.currentTime + i * 0.22
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.18, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
    o.connect(g).connect(a.destination)
    o.start(t)
    o.stop(t + 0.55)
  })
}

/* ───────── 동작 ───────── */
const notify = (title: string, body: string) => {
  if (loadNotify().enabled) void showSystemNotification(title, body, { id: '' }, `timer-${Date.now()}`)
}

/** 집중 시작 (항목 없이도 가능) */
export async function startFocus(item?: Pick<Item, 'id' | 'title'>, minutes?: number) {
  const st = useTimer.getState()
  if (st.phase === 'focus' && elapsedMs(st) >= 60_000) await stopFocus(true) // 하던 집중은 기록하고 바꾼다
  audio() // 사용자 클릭 시점에 소리 준비 (브라우저 정책)
  const today = ymd(new Date())
  useTimer.setState({
    phase: 'focus',
    running: true,
    itemId: item?.id,
    title: item?.title || '집중',
    plannedMs: (minutes ?? loadTimerSettings().focus) * 60_000,
    accumulated: 0,
    runStartedAt: Date.now(),
    sessionStart: new Date().toISOString(),
    count: st.countDate === today ? st.count : 0,
    countDate: today,
    justFinished: undefined,
  })
}

export function pause() {
  const s = useTimer.getState()
  if (!s.running) return
  useTimer.setState({ running: false, accumulated: elapsedMs(s), runStartedAt: null })
}
export function resume() {
  const s = useTimer.getState()
  if (s.running || s.phase === 'idle') return
  audio()
  useTimer.setState({ running: true, runStartedAt: Date.now() })
}
export const toggle = () => (useTimer.getState().running ? pause() : resume())

/** 집중 기록 저장 (1분 미만은 버림) */
async function record(s: TimerState) {
  const minutes = Math.round(elapsedMs(s) / 60000)
  if (minutes < 1 || !s.sessionStart) return 0
  await addSession({ itemId: s.itemId, title: s.title, start: s.sessionStart, end: new Date().toISOString(), minutes, date: ymd(new Date(s.sessionStart)) })
  return minutes
}

/** 집중을 끝냄: keep=true 면 기록, 휴식으로 넘어갈지는 설정에 따름 */
export async function stopFocus(keep = true, natural = false) {
  const s = useTimer.getState()
  if (s.phase !== 'focus') return
  const minutes = keep ? await record(s) : 0
  const count = natural ? s.count + 1 : s.count
  const set = loadTimerSettings()
  const finished = minutes ? { itemId: s.itemId, title: s.title, minutes } : undefined
  if (natural && set.autoBreak) {
    const long = count % set.longEvery === 0
    useTimer.setState({ ...IDLE, phase: 'break', running: true, title: long ? '긴 휴식' : '휴식', plannedMs: (long ? set.longBreak : set.shortBreak) * 60_000, runStartedAt: Date.now(), count, countDate: s.countDate, justFinished: finished })
  } else useTimer.setState({ ...IDLE, count, countDate: s.countDate, justFinished: finished })
}

export function skipBreak() {
  const s = useTimer.getState()
  useTimer.setState({ ...IDLE, count: s.count, countDate: s.countDate, justFinished: s.justFinished })
}

export const dismissFinished = () => useTimer.setState({ justFinished: undefined })

/** 1초마다 불러서 시간이 다 됐는지 확인 */
export async function tick(onDone: (msg: string) => void) {
  const s = useTimer.getState()
  if (!s.running || s.phase === 'idle' || remainingMs(s) > 0) return
  if (s.phase === 'focus') {
    const title = s.title
    await stopFocus(true, true)
    chime('focus')
    const brk = useTimer.getState().phase === 'break'
    const msg = `"${title}" 집중 ${Math.round(s.plannedMs / 60000)}분 끝! ${brk ? `${useTimer.getState().title} ${Math.round(useTimer.getState().plannedMs / 60000)}분을 시작해요.` : ''}`
    notify('집중 완료 🎉', msg)
    onDone(msg)
  } else {
    skipBreak()
    chime('break')
    notify('휴식 끝', '다음 집중을 시작해 볼까요?')
    onDone('휴식 끝! 다음 집중을 시작해 볼까요?')
  }
}
