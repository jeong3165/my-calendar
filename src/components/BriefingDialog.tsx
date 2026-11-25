import { useEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../store'
import type { Item } from '../types'
import { useCalendarItems } from '../lib/subs'
import { useProjects } from '../lib/projects'
import { resolveItem } from '../lib/recur'
import { loadSettings } from '../lib/importFiles'
import { briefingForAI, buildBriefing, dueLabel, isEmpty, loadAINote, loadBriefing, saveAINote, summaryLine, timeLabel, type Briefing } from '../lib/briefing'
import { Checkbox, Icon, toggleDone } from './ui'
import { Markdown } from './Markdown'
import { useDdays } from '../lib/dday'

/** 아침 브리핑: 오늘 일정·할 일·마감을 한눈에 */
export function BriefingDialog() {
  const { open, setMode, setDaySub, setSettings, isMobile } = useUI()
  const close = () => useUI.setState({ briefingOpen: false })
  const all = useCalendarItems()
  const projects = useProjects()
  // 연 순간의 목록을 고정하고(체크해도 사라지지 않게), 완료 여부만 실시간으로
  const [snap, setSnap] = useState<Briefing | null>(null)
  const basedOn = useRef(0)
  useEffect(() => {
    if (!snap || (basedOn.current === 0 && all.length > 0)) {
      basedOn.current = all.length
      setSnap(buildBriefing(all))
    }
  }, [all, snap])
  const soonDdays = useDdays().filter((d) => d.diff > 0 && d.diff <= 7)
  const live = (it: Item) => resolveItem(all, it.id) ?? it
  const pname = useMemo(() => (id?: string) => projects.find((p) => p.id === id)?.title, [projects])

  // AI 한마디 (켜 둔 경우, 하루 한 번만 만들고 저장)
  const st = loadBriefing()
  const [note, setNote] = useState<string | null>(() => (snap ? loadAINote(snap.date) : null))
  const [noteState, setNoteState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [noteErr, setNoteErr] = useState('')
  const abort = useRef<AbortController | null>(null)
  async function makeNote(b: Briefing, force = false) {
    const s = loadSettings()
    if (!s.apiKey) return
    if (!force) {
      const cached = loadAINote(b.date)
      if (cached) return setNote(cached)
    }
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setNoteState('loading')
    try {
      const { briefingNote } = await import('../lib/ai')
      const text = await briefingNote(briefingForAI(b, pname), st.city.trim(), s, ctrl.signal)
      saveAINote(b.date, text)
      setNote(text)
      setNoteState('idle')
    } catch (e) {
      if (ctrl.signal.aborted) return
      setNoteErr(e instanceof Error ? e.message : String(e))
      setNoteState('error')
    }
  }
  useEffect(() => {
    if (snap && st.ai && basedOn.current > 0) void makeNote(snap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap])
  useEffect(() => () => abort.current?.abort(), [])

  const go = (id: string) => {
    open(id)
    if (isMobile) close()
  }

  const b = snap
  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/30 md:items-start md:px-4 md:pt-[6vh]" onMouseDown={close}>
      <div role="dialog" aria-label="아침 브리핑" onMouseDown={(e) => e.stopPropagation()} className="shadow-pop flex w-full flex-col overflow-hidden bg-popover pt-[env(safe-area-inset-top)] md:max-h-[88vh] md:max-w-[560px] md:rounded-[12px] md:pt-0">
        <div className="flex items-center gap-2.5 border-b border-line px-5 py-3">
          <span className="text-[22px] leading-none">☀️</span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">아침 브리핑</h2>
            {b && <p className="text-[12px] text-fg2">{b.label}</p>}
          </div>
          <button onClick={close} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>

        {b && (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <p className="rounded-[8px] bg-hover px-3 py-2 text-[13.5px]">{summaryLine(b)}</p>

            {st.ai && (
              <section className="rounded-[10px] border border-[var(--c-purple-bar)]/30 bg-[var(--c-purple-bg)]/40 px-3.5 py-3 text-[14px] leading-[1.65]">
                <div className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-[var(--c-purple-bar)]">
                  <Icon name="sparkle" size={13} /> AI 한마디{st.city.trim() ? ` · ${st.city.trim()} 날씨 포함` : ''}
                  {note && noteState !== 'loading' && (
                    <button onClick={() => void makeNote(b, true)} className="ml-auto rounded px-1.5 text-[11.5px] font-normal text-fg3 hover:bg-hover hover:text-fg" title="지금 자료로 다시 만들기">
                      다시 만들기
                    </button>
                  )}
                </div>
                {!loadSettings().apiKey ? (
                  <p className="text-[13px] text-fg2">
                    AI 한마디를 쓰려면{' '}
                    <button onClick={() => (close(), setSettings(true, 'ai'))} className="text-accent underline underline-offset-2">
                      Claude API 키
                    </button>
                    를 넣어 주세요.
                  </p>
                ) : noteState === 'loading' ? (
                  <p className="animate-pulse text-[13px] text-fg2">오늘 하루를 정리하는 중…</p>
                ) : noteState === 'error' ? (
                  <p className="text-[13px] text-danger">
                    {noteErr}{' '}
                    <button onClick={() => void makeNote(b, true)} className="text-fg2 underline underline-offset-2">
                      다시 시도
                    </button>
                  </p>
                ) : note ? (
                  <Markdown text={note} />
                ) : null}
              </section>
            )}

            {isEmpty(b) ? (
              <p className="py-6 text-center text-[14px] text-fg2">오늘은 비어 있어요 🌿</p>
            ) : (
              <>
                <Group title="오늘 일정" icon="calendar" items={b.events} render={(it) => <Row key={it.id} it={live(it)} meta={timeLabel(it)} sub={it.readonly?.name ?? pname(it.projectId)} onOpen={go} check={it.type === 'task'} />} />
                <Group title="밀린 할 일" icon="clock" tone="danger" items={b.overdue} render={(it) => <Row key={it.id} it={live(it)} meta={dueLabel(it)} sub={pname(it.projectId)} onOpen={go} check />} />
                <Group title="오늘 할 일" icon="checklist" items={[...b.dueToday, ...b.doing]} render={(it) => <Row key={it.id} it={live(it)} meta={it.doing ? '진행 중' : ''} sub={pname(it.projectId)} onOpen={go} check />} />
                <Group title="오늘의 습관" icon="flame" items={b.habits} render={(it) => <Row key={it.id} it={live(it)} onOpen={go} check />} />
                <Group title="곧 마감 (3일 안)" icon="flag" items={b.soon} render={(it) => <Row key={it.id} it={live(it)} meta={dueLabel(it)} sub={pname(it.projectId)} onOpen={go} check />} />
                {soonDdays.length > 0 && (
                  <section>
                    <h3 className="mb-1 flex items-center gap-1.5 text-[12px] font-medium text-fg3">
                      <Icon name="calendar" size={13} /> 다가오는 기념일 <span className="font-normal">{soonDdays.length}</span>
                    </h3>
                    <ul className="flex flex-col">
                      {soonDdays.map((d) => (
                        <li key={d.item.id}>
                          <button onClick={() => useUI.setState({ ddayEdit: d.item.id })} className="flex w-full items-center gap-2 rounded-[6px] px-1 py-1 text-left hover:bg-hover">
                            <span className="w-4 text-center">{d.item.icon ?? '🎉'}</span>
                            <span className="min-w-0 flex-1 truncate text-[14px]">{d.item.title}</span>
                            <span className="tnum text-[12px] font-semibold text-danger">{d.label}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
                <Group title="이번 주 마감 프로젝트" icon="folder" items={b.projects} render={(it) => <Row key={it.id} it={it} meta={dueLabel({ ...it, type: 'task' })} onOpen={(id) => (useUI.getState().openProject(id), close())} />} />
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
          <button onClick={() => (close(), setSettings(true, 'notify'))} className="rounded-[6px] px-2 py-1.5 text-[12.5px] text-fg2 hover:bg-hover">
            브리핑 설정
          </button>
          <span className="flex-1" />
          <button
            onClick={() => {
              close()
              setMode('day')
              setDaySub('plan')
            }}
            className="rounded-[6px] border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover"
          >
            아침 계획 세우기
          </button>
          <button onClick={close} className="rounded-[6px] bg-accent px-3.5 py-1.5 text-[13px] font-medium text-white hover:brightness-110">
            좋아요
          </button>
        </div>
      </div>
    </div>
  )
}

function Group({ title, icon, items, render, tone }: { title: string; icon: 'calendar' | 'clock' | 'checklist' | 'flame' | 'flag' | 'folder'; items: Item[]; render: (it: Item) => React.ReactNode; tone?: 'danger' }) {
  if (!items.length) return null
  return (
    <section>
      <h3 className={`mb-1 flex items-center gap-1.5 text-[12px] font-medium ${tone === 'danger' ? 'text-danger' : 'text-fg3'}`}>
        <Icon name={icon} size={13} /> {title} <span className="font-normal">{items.length}</span>
      </h3>
      <ul className="flex flex-col">{items.slice(0, 12).map(render)}</ul>
      {items.length > 12 && <p className="pl-7 text-[12px] text-fg3">외 {items.length - 12}개</p>}
    </section>
  )
}

function Row({ it, meta, sub, onOpen, check }: { it: Item; meta?: string; sub?: string; onOpen: (id: string) => void; check?: boolean }) {
  return (
    <li className="flex items-center gap-2 rounded-[6px] px-1 py-1 hover:bg-hover">
      {check && !it.readonly ? (
        <Checkbox checked={!!it.done} onChange={() => void toggleDone(it)} size={15} />
      ) : (
        <span className="mx-[3px] h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--c-${it.color}-bar)` }} />
      )}
      <button onClick={() => onOpen(it.id)} className={`min-w-0 flex-1 truncate text-left text-[14px] ${it.done ? 'text-fg3 line-through' : ''}`}>
        {it.title || '제목 없음'}
        {sub && <span className="ml-1.5 text-[12px] text-fg3">{sub}</span>}
      </button>
      {meta && <span className="tnum shrink-0 text-[12px] text-fg2">{meta}</span>}
    </li>
  )
}
