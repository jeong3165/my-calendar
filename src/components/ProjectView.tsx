import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { differenceInCalendarDays } from 'date-fns'
import { createItem, updateItem, useItems, useSessions } from '../db'
import { useUI } from '../store'
import { COLORS, COLOR_LABEL, type Item } from '../types'
import { parseYmd, relDay, ymd } from '../lib/date'
import { colorVars, tagColor, taskKey } from '../lib/items'
import { parseQuick, parsedToItem } from '../lib/parse'
import { deleteProject, PROJECT_ICONS, projectStats, subtaskProgress } from '../lib/projects'
import { statusOf } from '../lib/dbview'
import { fmtMinutes } from '../lib/review'
import { Checkbox, FocusButton, Icon, toggleDone } from './ui'
import { fmtWhen, isOverdue } from './viewUtil'

/** 노션 페이지 같은 프로젝트 화면 */
export function ProjectView() {
  const projectId = useUI((s) => s.projectId)
  const items = useItems()
  const p = items.find((x) => x.id === projectId && x.type === 'project')
  if (!p)
    return (
      <div className="grid flex-1 place-items-center text-[14px] text-fg3">
        <p>프로젝트를 찾을 수 없어요. 사이드바에서 다른 프로젝트를 골라 주세요.</p>
      </div>
    )
  return <ProjectPage key={p.id} p={p} items={items} />
}

function ProjectPage({ p, items }: { p: Item; items: Item[] }) {
  const { open, selectedId, setMode, showToast } = useUI()
  const sessions = useSessions('0000-01-01', '9999-12-31')
  const st = useMemo(() => projectStats(p, items, sessions), [p, items, sessions])
  const [title, setTitle] = useState(p.title)
  const [note, setNote] = useState(p.note ?? '')
  const [iconOpen, setIconOpen] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const set = (patch: Partial<Item>) => updateItem(p.id, patch)

  const today = ymd(new Date())
  const dLeft = p.due ? differenceInCalendarDays(parseYmd(p.due), new Date()) : null
  const doing = st.tasks.filter((t) => statusOf(t) === 'doing')
  const todo = st.tasks.filter((t) => statusOf(t) === 'todo').sort((a, b) => (taskKey(a) ?? '9999').localeCompare(taskKey(b) ?? '9999'))
  const done = st.tasks.filter((t) => t.done).sort((a, b) => (b.doneAt ?? b.updatedAt).localeCompare(a.doneAt ?? a.updatedAt))
  const upcoming = st.events.filter((e) => (e.end ? ymd(new Date(e.end)) : '') >= today).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 md:px-10">
      <div className="mx-auto max-w-[860px] pt-4">
        {/* 아이콘 + 제목 */}
        <div className="relative">
          <button onClick={() => setIconOpen(!iconOpen)} className="rounded-[8px] p-1 text-[44px] leading-none hover:bg-hover" title="아이콘 바꾸기">
            {p.icon ?? '📁'}
          </button>
          {iconOpen && (
            <div className="shadow-pop absolute top-full left-0 z-20 mt-1 grid grid-cols-6 gap-1 rounded-[10px] bg-popover p-2">
              {PROJECT_ICONS.map((e) => (
                <button
                  key={e}
                  onClick={() => {
                    void set({ icon: e })
                    setIconOpen(false)
                  }}
                  className="grid h-9 w-9 place-items-center rounded-[6px] text-[22px] hover:bg-hover"
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          value={title}
          autoFocus={!p.title}
          onChange={(e) => {
            setTitle(e.target.value)
            void set({ title: e.target.value })
          }}
          placeholder="프로젝트 이름"
          className={`mt-2 w-full bg-transparent text-[32px] leading-tight font-bold tracking-[-0.01em] outline-none ${p.done ? 'text-fg3' : ''}`}
        />

        {/* 속성 */}
        <div className="mt-4 flex flex-col gap-1 text-[14px]">
          <Row icon="status" label="상태">
            {(
              [
                [false, '진행 중'],
                [true, '완료'],
              ] as const
            ).map(([v, l]) => (
              <button key={l} onClick={() => set({ done: v, doneAt: v ? new Date().toISOString() : undefined })} className={`rounded-[4px] px-2 py-0.5 text-[13px] ${!!p.done === v ? 'bg-active font-medium' : 'text-fg2 hover:bg-hover'}`}>
                {l}
              </button>
            ))}
          </Row>
          <Row icon="calendar" label="마감일">
            <input type="date" value={p.due ?? ''} onChange={(e) => set({ due: e.target.value || undefined })} className="tnum rounded-[4px] bg-transparent px-2 py-0.5 outline-none hover:bg-hover" />
            {dLeft !== null && !p.done && (
              <span className={`tnum text-[13px] ${dLeft < 0 ? 'text-danger' : dLeft <= 7 ? 'text-[var(--c-orange-bar)]' : 'text-fg2'}`}>{dLeft === 0 ? 'D-day' : dLeft > 0 ? `D-${dLeft}` : `${-dLeft}일 지남`}</span>
            )}
          </Row>
          <Row icon="palette" label="색상">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => set({ color: c })}
                title={COLOR_LABEL[c]}
                aria-label={COLOR_LABEL[c]}
                className={`h-5 w-5 rounded-[4px] border ${p.color === c ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg' : ''}`}
                style={{ background: `var(--c-${c}-bg)`, borderColor: `var(--c-${c}-bar)` }}
              />
            ))}
          </Row>
        </div>

        {/* 진행률 */}
        <div className="mt-5 rounded-[10px] border border-line p-4">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="tnum text-[26px] font-bold">{Math.round(st.pct * 100)}%</span>
            <span className="text-[13px] text-fg2">
              할 일 {st.total}개 중 {st.done}개 완료{st.overdue ? <span className="text-danger"> · 지난 할 일 {st.overdue}개</span> : ''}
              {st.focusMinutes ? ` · 집중 ⏱ ${fmtMinutes(st.focusMinutes)}` : ''}
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-active">
            <div className="h-full rounded-full transition-all" style={{ width: `${st.pct * 100}%`, background: `var(--c-${p.color}-bar)` }} />
          </div>
        </div>

        {/* 설명 */}
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value)
            void set({ note: e.target.value || undefined })
          }}
          rows={Math.max(2, note.split('\n').length)}
          placeholder="프로젝트 설명, 목표, 참고 링크…"
          className="mt-5 w-full resize-none bg-transparent text-[15px] leading-[26px] outline-none"
        />

        {/* 할 일 */}
        <section className="mt-4">
          <h3 className="mb-1 px-1 text-[15px] font-semibold">할 일</h3>
          <AddTask projectId={p.id} />
          {doing.length > 0 && <Group label="진행 중" color="blue" list={doing} selectedId={selectedId} onOpen={open} />}
          <Group label="할 일" color="gray" list={todo} selectedId={selectedId} onOpen={open} empty={!doing.length && !done.length ? '아직 할 일이 없어요. 위에 적어 보세요.' : undefined} />
          {done.length > 0 && (
            <>
              <button onClick={() => setShowDone(!showDone)} className="mt-2 flex items-center gap-1 px-1 text-[13px] text-fg2 hover:text-fg">
                {showDone ? '▾' : '▸'} 완료 {done.length}
              </button>
              {showDone && <Group label="" color="green" list={done} selectedId={selectedId} onOpen={open} />}
            </>
          )}
        </section>

        {/* 일정 */}
        {upcoming.length > 0 && (
          <section className="mt-6">
            <h3 className="mb-1 px-1 text-[15px] font-semibold">다가오는 일정</h3>
            <ul>
              {upcoming.map((e) => (
                <li key={e.id}>
                  <button onClick={() => open(e.id)} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-hover">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--c-${e.color}-bar)` }} />
                    <span className="min-w-0 flex-1 truncate text-[14px]">{e.title}</span>
                    <span className="tnum text-[12px] text-fg2">{fmtWhen(e)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-6 px-1 text-[12px] text-fg3">
          다른 곳에서 할 일을 만들 때 <code className="rounded bg-hover px-1">@{p.title.replace(/\s+/g, '') || '프로젝트'}</code> 를 붙이면 이 프로젝트로 들어와요. 상세 화면의 "프로젝트" 속성으로도 옮길 수 있어요.
        </p>
        <button
          onClick={async () => {
            if (!confirm(`'${p.title || '이름 없는 프로젝트'}' 프로젝트를 지울까요?\n안에 있던 할 일과 일정은 지워지지 않고 남아요.`)) return
            await deleteProject(p.id)
            setMode('calendar')
            showToast('프로젝트를 지웠어요. 할 일은 그대로 남아 있어요.')
          }}
          className="mt-3 flex items-center gap-1 rounded-[6px] px-2 py-1 text-[13px] text-fg3 hover:bg-hover hover:text-danger"
        >
          <Icon name="trash" size={14} /> 프로젝트 삭제
        </button>
      </div>
    </div>
  )
}

function Row({ icon, label, children }: { icon: 'status' | 'calendar' | 'palette'; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[32px] items-center">
      <span className="flex w-[110px] shrink-0 items-center gap-1.5 text-fg2">
        <Icon name={icon} size={15} className="text-fg3" />
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  )
}

function Group({ label, color, list, selectedId, onOpen, empty }: { label: string; color: string; list: Item[]; selectedId: string | null; onOpen: (id: string) => void; empty?: string }) {
  return (
    <div className="mt-2">
      {label && (
        <div className="mb-0.5 flex items-center gap-2 px-1">
          <span className="rounded-[4px] px-1.5 py-px text-[12px] font-medium" style={colorVars(color as never)}>
            {label}
          </span>
          <span className="tnum text-[12px] text-fg3">{list.length}</span>
        </div>
      )}
      {list.length === 0 && empty && <p className="px-2 py-2 text-[13px] text-fg3">{empty}</p>}
      <ul>
        {list.map((t) => (
          <TaskLine key={t.id} t={t} selected={t.id === selectedId} onOpen={() => onOpen(t.id)} />
        ))}
      </ul>
    </div>
  )
}

export function TaskLine({ t, selected, onOpen }: { t: Item; selected: boolean; onOpen: () => void }) {
  const sp = subtaskProgress(t)
  const k = taskKey(t)
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-item', t.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onOpen}
      className={`group flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 ${selected ? 'bg-active' : 'hover:bg-hover'}`}
    >
      <Checkbox checked={!!t.done} onChange={() => toggleDone(t)} size={15} />
      <span className={`min-w-0 flex-1 truncate text-[14px] ${t.done ? 'text-fg3 line-through' : ''}`}>{t.title || '제목 없음'}</span>
      {sp && <SubBadge done={sp.done} total={sp.total} />}
      {t.priority === 'high' && !t.done && <Icon name="flag" size={12} className="shrink-0 text-danger" />}
      {t.tags.slice(0, 2).map((tag) => (
        <span key={tag} className="hidden shrink-0 rounded-[3px] px-1 text-[11px] sm:inline" style={colorVars(tagColor(tag))}>
          {tag}
        </span>
      ))}
      {k && <span className={`tnum shrink-0 text-[12px] ${isOverdue(t) ? 'text-danger' : 'text-fg2'}`}>{t.start ? fmtWhen(t) : relDay(k)}</span>}
      {!t.done && <FocusButton item={t} className="opacity-0 group-hover:opacity-100" />}
    </li>
  )
}

export function SubBadge({ done, total }: { done: number; total: number }) {
  return (
    <span className={`tnum flex shrink-0 items-center gap-0.5 rounded-[4px] px-1 text-[11px] ${done === total ? 'text-[var(--c-green-bar)]' : 'text-fg2'}`} title={`하위 할 일 ${done}/${total}`}>
      ☑ {done}/{total}
    </span>
  )
}

function AddTask({ projectId }: { projectId: string }) {
  const [v, setV] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  async function add() {
    const p = parseQuick(v)
    if (!p.title) return
    await createItem({ type: 'task', ...parsedToItem(p, 'task'), projectId })
    setV('')
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') void add()
    if (e.key === 'Escape') setV('')
  }
  return (
    <label className="flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-fg3 focus-within:bg-hover hover:bg-hover">
      <Icon name="plus" size={15} />
      <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={onKey} placeholder="할 일 추가 (예: 다음주 월요일 견적 받기 !높음)" className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none" />
    </label>
  )
}
