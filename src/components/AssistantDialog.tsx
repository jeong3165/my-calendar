import { useMemo, useRef, useState } from 'react'
import { useUI } from '../store'
import type { Item } from '../types'
import { loadSettings } from '../lib/importFiles'
import { parseYmd } from '../lib/date'
import { useCalendarItems } from '../lib/subs'
import { useProjects } from '../lib/projects'
import type { PlanTurn } from '../lib/ai'
import {
  applyProposals,
  buildContext,
  checkProposal,
  conflicts,
  fmtDay,
  KIND_LABEL,
  loadAssistant,
  saveAssistant,
  toProposals,
  undoApply,
  type Proposal,
  type Undo,
} from '../lib/assistant'
import { Checkbox, Icon } from './ui'

const EXAMPLES = [
  '다음 주 빈 시간에 운동 3번 넣어줘 (1시간씩, 저녁에)',
  '이번 주 마감인 할 일들을 시간표에 배치해줘',
  '오늘 남은 할 일을 오후 시간에 나눠서 넣어줘',
  '매일 아침 30분 영어 공부 시간을 이번 주에 잡아줘',
]

type Stage = 'ask' | 'loading' | 'review' | 'done'

export function AssistantDialog() {
  const { setSettings, showToast, setMode, setView, setDate } = useUI()
  const close = () => useUI.setState({ assistantOpen: false })
  const all = useCalendarItems()
  const projects = useProjects()
  const [stage, setStage] = useState<Stage>('ask')
  const [req, setReq] = useState('')
  const [refine, setRefine] = useState('')
  const [history, setHistory] = useState<PlanTurn[]>([])
  const [summary, setSummary] = useState('')
  const [question, setQuestion] = useState<string | null>(null)
  const [list, setList] = useState<Proposal[]>([])
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<Undo | null>(null)
  const [hours, setHours] = useState(loadAssistant)
  const abortRef = useRef<AbortController | null>(null)
  const ctxRef = useRef<ReturnType<typeof buildContext> | null>(null)
  const hasKey = !!loadSettings().apiKey

  async function ask(text: string, prev: PlanTurn[]) {
    if (!text.trim()) return
    if (!hasKey) return setError('AI 비서를 쓰려면 Claude API 키가 필요해요. 설정 → AI 탭에서 넣어 주세요.')
    setError(null)
    setStage('loading')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      // 처음 요청이면 지금 캘린더 상태를 함께 보낸다
      let turns: PlanTurn[]
      if (!prev.length) {
        ctxRef.current = buildContext(all)
        turns = [{ role: 'user', content: `${ctxRef.current.text}\n\n[요청]\n${text.trim()}` }]
      } else turns = [...prev, { role: 'user', content: `[이어서 요청] 위 제안을 이렇게 고쳐 주세요: ${text.trim()}` }]
      const { planSchedule } = await import('../lib/ai')
      const plan = await planSchedule(turns, loadSettings(), ctrl.signal)
      setHistory([...turns, { role: 'assistant', content: JSON.stringify(plan) }])
      setSummary(plan.summary)
      setQuestion(plan.question)
      // 받은 때 한 번만 시간순 정렬 (고치는 중에 카드가 움직이지 않도록)
      setList(toProposals(plan.actions, all, ctxRef.current!).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start)))
      setRefine('')
      setStage('review')
    } catch (e) {
      setError((e as Error).message)
      setStage(prev.length ? 'review' : 'ask')
    } finally {
      abortRef.current = null
    }
  }

  const update = (key: string, patch: Partial<Proposal>) => setList((l) => l.map((p) => (p.key === key ? { ...p, ...patch } : p)))
  const included = list.filter((p) => p.include)
  const broken = included.filter((p) => checkProposal(p))

  async function apply() {
    if (!included.length || broken.length) return
    const u = await applyProposals(included)
    setUndo(u)
    setStage('done')
    const first = included.map((p) => p.date).sort()[0]
    if (first) {
      setMode('calendar')
      setView('week')
      setDate(parseYmd(first))
    }
  }

  // 날짜별로 묶어서 보여 주기
  const groups = useMemo(() => {
    const m = new Map<string, Proposal[]>()
    for (const p of list) m.set(p.date, [...(m.get(p.date) ?? []), p])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [list])

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/30 md:items-start md:px-4 md:pt-[6vh]" onMouseDown={() => stage !== 'loading' && close()}>
      <div role="dialog" aria-label="AI 일정 비서" onMouseDown={(e) => e.stopPropagation()} className="shadow-pop flex w-full flex-col overflow-hidden bg-popover md:max-h-[88vh] md:max-w-[760px] md:rounded-[12px]">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Icon name="sparkle" size={18} className="text-[var(--c-purple-bar)]" />
          <h2 className="flex-1 text-[16px] font-semibold">AI 일정 비서</h2>
          <button onClick={close} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>

        {stage === 'ask' && (
          <div className="flex flex-col gap-3 overflow-y-auto p-5">
            <textarea
              autoFocus
              value={req}
              onChange={(e) => setReq(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask(req, [])
              }}
              rows={3}
              placeholder="무엇을 도와드릴까요? 예) 다음 주 빈 시간에 운동 3번 넣어줘"
              className="resize-none rounded-[10px] border border-line-strong bg-bg px-3.5 py-3 text-[15px] outline-none focus:border-accent"
            />
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => (
                <button key={x} onClick={() => setReq(x)} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-fg2 hover:bg-hover hover:text-fg">
                  {x}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-[8px] bg-hover px-3 py-2 text-[12px] text-fg2">
              <span>일정을 넣어도 되는 시간</span>
              <input type="time" value={hours.dayStart} onChange={(e) => setHours({ ...hours, dayStart: e.target.value })} onBlur={() => saveAssistant(hours)} className="tnum rounded bg-bg px-1 outline-none" />
              ~
              <input type="time" value={hours.dayEnd} onChange={(e) => setHours({ ...hours, dayEnd: e.target.value })} onBlur={() => saveAssistant(hours)} className="tnum rounded bg-bg px-1 outline-none" />
              <span>· 오늘부터 {hours.days}일 · 할 일·일정의 제목과 시간이 Anthropic API로 전송돼요</span>
            </div>
            {error && (
              <p className="flex items-start gap-1.5 text-[13px] text-danger">
                <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
                <span>
                  {error}
                  {!hasKey && (
                    <button onClick={() => setSettings(true, 'ai')} className="ml-2 underline">
                      설정 열기
                    </button>
                  )}
                </span>
              </p>
            )}
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-fg3">Ctrl/⌘ + Enter 로 보내기 · 적용하기 전에 검토하고 고칠 수 있어요</span>
              <button onClick={() => ask(req, [])} disabled={!req.trim()} className="flex h-9 items-center gap-1.5 rounded-[6px] bg-accent px-4 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40">
                <Icon name="sparkle" size={15} /> 계획 짜기
              </button>
            </div>
          </div>
        )}

        {stage === 'loading' && (
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-[var(--c-purple-bar)]" />
            <p className="text-[15px] font-medium">빈 시간을 살펴보고 계획을 짜는 중이에요…</p>
            <p className="text-[13px] text-fg2">보통 10~40초 걸려요.</p>
            <button onClick={() => abortRef.current?.abort()} className="mt-2 rounded-[6px] border border-line-strong px-3 py-1 text-[13px] hover:bg-hover">
              취소
            </button>
          </div>
        )}

        {stage === 'review' && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {summary && <p className="mb-2 rounded-[8px] px-3 py-2.5 text-[14px] leading-relaxed" style={{ background: 'var(--c-purple-bg)', color: 'var(--c-purple-text)' }}>{summary}</p>}
              {question && (
                <p className="mb-2 flex items-start gap-1.5 rounded-[8px] bg-hover px-3 py-2 text-[13px]">
                  <Icon name="alert" size={15} className="mt-0.5 shrink-0 text-[var(--c-orange-bar)]" />
                  {question} <span className="text-fg3">— 아래 칸에 답해 주세요.</span>
                </p>
              )}
              {error && <p className="mb-2 text-[13px] text-danger">{error}</p>}
              {groups.map(([date, ps]) => (
                <section key={date} className="mt-3">
                  <h3 className="mb-1 px-1 text-[13px] font-semibold text-fg2">{fmtDay(date) || '날짜 없음'}</h3>
                  <ul className="flex flex-col gap-1.5">
                    {ps.map((p) => (
                      <ProposalRow key={p.key} p={p} all={all} others={list} projects={projects} onChange={(patch) => update(p.key, patch)} />
                    ))}
                  </ul>
                </section>
              ))}
              {!list.length && !question && <p className="py-6 text-center text-[13px] text-fg3">제안이 없어요. 아래에서 다르게 요청해 보세요.</p>}
            </div>
            <div className="flex flex-col gap-2 border-t border-line px-5 py-3">
              <div className="flex items-center gap-2">
                <input
                  value={refine}
                  onChange={(e) => setRefine(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return
                    if (e.key === 'Enter') void ask(refine, history)
                  }}
                  placeholder={question ? '답변을 적어 주세요' : '이어서 요청 (예: 운동은 아침으로 바꿔줘, 수요일은 빼줘)'}
                  className="min-w-0 flex-1 rounded-[8px] border border-line-strong bg-bg px-3 py-2 text-[14px] outline-none focus:border-accent"
                />
                <button onClick={() => ask(refine, history)} disabled={!refine.trim()} className="h-9 shrink-0 rounded-[6px] border border-line-strong px-3 text-[13px] hover:bg-hover disabled:opacity-40">
                  다시 짜기
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button onClick={() => (setStage('ask'), setHistory([]), setList([]))} className="h-8 rounded-[6px] px-2 text-[13px] text-fg2 hover:bg-hover">
                  ← 새 요청
                </button>
                <span className="flex-1 text-right text-[12px]">{broken.length > 0 ? <span className="text-danger">고칠 곳이 있는 제안 {broken.length}개</span> : <span className="text-fg3">노란 칸은 겹침 경고예요 (그래도 적용할 수 있어요)</span>}</span>
                <button onClick={apply} disabled={!included.length || broken.length > 0} className="h-9 rounded-[6px] bg-accent px-4 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40">
                  선택한 {included.length}개 적용
                </button>
              </div>
            </div>
          </>
        )}

        {stage === 'done' && (
          <div className="flex flex-col items-center gap-3 px-5 py-12 text-center">
            <p className="text-[32px]">✅</p>
            <p className="text-[15px] font-medium">캘린더에 적용했어요.</p>
            <p className="text-[13px] text-fg2">주간 보기로 옮겨 두었어요. 마음에 들지 않으면 한 번에 되돌릴 수 있어요.</p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={async () => {
                  if (undo) await undoApply(undo)
                  setUndo(null)
                  setStage('review')
                  showToast('적용하기 전으로 되돌렸어요.')
                }}
                className="rounded-[6px] border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover"
              >
                되돌리기
              </button>
              <button onClick={close} className="rounded-[6px] bg-accent px-4 py-1.5 text-[14px] font-medium text-white">
                닫고 캘린더 보기
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProposalRow({ p, all, others, projects, onChange }: { p: Proposal; all: Item[]; others: Proposal[]; projects: Item[]; onChange: (patch: Partial<Proposal>) => void }) {
  const err = p.problem ?? checkProposal(p)
  const warn = !err && p.include ? conflicts(p, all, others) : undefined
  const inCls = 'tnum rounded-[4px] border border-line bg-transparent px-1.5 py-0.5 text-[13px] outline-none focus:border-accent'
  return (
    <li className={`rounded-[8px] border p-2.5 ${!p.include ? 'opacity-50' : err ? 'border-danger/60' : warn ? 'border-[var(--c-yellow-bar)]' : 'border-line'}`}>
      <div className="flex items-center gap-2">
        <Checkbox checked={p.include} onChange={(v) => onChange({ include: v })} size={15} label="이 제안 적용" />
        <span className="shrink-0 rounded-[4px] px-1.5 py-px text-[11px] font-medium" style={{ background: `var(--c-${p.kind === 'create' ? 'green' : p.kind === 'schedule' ? 'blue' : 'orange'}-bg)`, color: `var(--c-${p.kind === 'create' ? 'green' : p.kind === 'schedule' ? 'blue' : 'orange'}-text)` }}>
          {p.kind === 'create' ? `새 ${p.type === 'event' ? '일정' : '할 일'}` : KIND_LABEL[p.kind]}
        </span>
        {p.kind === 'create' ? (
          <input value={p.title} onChange={(e) => onChange({ title: e.target.value })} className="min-w-0 flex-1 bg-transparent text-[14px] font-medium outline-none" />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{p.title}</span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[23px]">
        <input type="date" value={p.date} onChange={(e) => onChange({ date: e.target.value })} className={inCls} />
        {p.kind !== 'set_due' && (
          <>
            <input type="time" value={p.start} onChange={(e) => onChange({ start: e.target.value })} className={inCls} aria-label="시작" />
            <span className="text-fg3">–</span>
            <input type="time" value={p.end} onChange={(e) => onChange({ end: e.target.value })} className={inCls} aria-label="종료" />
          </>
        )}
        {p.kind === 'create' && projects.length > 0 && (
          <select value={p.projectId ?? ''} onChange={(e) => onChange({ projectId: e.target.value || undefined })} className={`${inCls} max-w-[160px]`} aria-label="프로젝트">
            <option value="">프로젝트 없음</option>
            {projects
              .filter((x) => !x.done)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.icon ?? '📁'} {x.title}
                </option>
              ))}
          </select>
        )}
      </div>
      <p className="mt-1 pl-[23px] text-[12px] text-fg2">{p.reason}</p>
      {err && <p className="mt-0.5 pl-[23px] text-[12px] text-danger">{err}</p>}
      {warn && <p className="mt-0.5 pl-[23px] text-[12px] text-[var(--c-orange-bar)]">⚠ {warn}</p>}
    </li>
  )
}
