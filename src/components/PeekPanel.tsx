import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { addDays, addMinutes, differenceInCalendarDays, startOfDay } from 'date-fns'
import { createItem, deleteSession, updateItem, useItemSessions } from '../db'
import { fmtMinutes } from '../lib/review'
import { fmtWhen } from './viewUtil'
import { useCalendarItems } from '../lib/subs'
import { useUI } from '../store'
import type { Item, Priority } from '../types'
import { COLORS, COLOR_LABEL, PRIORITY_LABEL, STATUS_LABEL, type Status } from '../types'
import { statusOf } from '../lib/dbview'
import { parseYmd, toLocalInput, ymd } from '../lib/date'
import { allTags, colorVars, isTimed, tagColor } from '../lib/items'
import { Checkbox, FocusButton, Icon, type IconName } from './ui'
import { baseDate, changeOccurrence, deleteSmart, isRecurring, repeatLabel, resolveItem, toggleOccurrenceDone, touchesTime, updateSmart } from '../lib/recur'
import { ProjectPicker, RemindEditor, RepeatEditor, SubtaskEditor } from './PeekExtras'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'

export function PeekPanel() {
  const { selectedId, close, isMobile } = useUI()
  const items = useCalendarItems()
  const item = selectedId ? resolveItem(items, selectedId) : undefined
  if (!item || item.type === 'project') return null // 프로젝트는 프로젝트 페이지에서
  return (
    <aside
      className={`flex min-h-0 flex-col bg-bg ${isMobile ? 'fixed inset-0 z-50' : 'w-[440px] shrink-0 border-l border-line xl:w-[480px]'}`}
      aria-label="상세 보기"
    >
      <div className="flex items-center gap-1 px-3 py-2">
        <button onClick={close} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기" title="닫기 (Esc)">
          <Icon name={isMobile ? 'x' : 'collapse'} size={16} className={isMobile ? '' : 'rotate-180'} />
        </button>
        <span className="flex items-center gap-1 text-[13px] text-fg3">
          {item.type === 'event' ? '일정' : '할 일'}
          {(item.occ || isRecurring(item)) && (
            <>
              · <Icon name="repeat" size={12} /> 반복
            </>
          )}
        </span>
        <div className="flex-1" />
        {!item.readonly && <FocusButton item={item} label />}
        {!item.readonly && <button
          onClick={async () => {
            if (!item.occ && !confirm(`'${item.title || '제목 없음'}'을(를) 삭제할까요?${isRecurring(item) ? '\n반복 일정 전체가 삭제돼요.' : ''}`)) return
            if (await deleteSmart(item)) close()
          }}
          className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[13px] text-fg2 hover:bg-hover hover:text-danger"
        >
          <Icon name="trash" size={15} /> 삭제
        </button>}
      </div>
      {item.readonly ? <ReadonlyBody key={item.id} item={item} /> : <PeekBody key={item.id} item={item} allItems={items} />}
    </aside>
  )
}

function PeekBody({ item, allItems }: { item: Item; allItems: Item[] }) {
  const draftId = useUI((s) => s.draftId)
  const [title, setTitle] = useState(item.title)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const isTask = item.type === 'task'

  useEffect(() => {
    if (draftId === item.id) titleRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => autoGrow(titleRef.current), [title])

  const { open, setSettings } = useUI()
  const occ = item.occ
  const series = occ ? allItems.find((i) => i.id === occ.seriesId) : item
  // 반복 회차의 날짜·시간 변경은 모아 두었다가 "적용"할 때 범위를 묻는다
  const [pending, setPending] = useState<Partial<Item>>({})
  const view: Item = { ...item, ...pending }

  const set = (patch: Partial<Item>) => {
    if (!occ) return updateItem(item.id, patch)
    const timeKeys = ['start', 'end', 'allDay', 'due'] as const
    const time = Object.fromEntries(Object.entries(patch).filter(([k]) => (timeKeys as readonly string[]).includes(k)))
    const rest = Object.fromEntries(Object.entries(patch).filter(([k]) => !(timeKeys as readonly string[]).includes(k) && k !== 'done'))
    if ('done' in patch && !!patch.done !== !!item.done) void toggleOccurrenceDone(item)
    if (Object.keys(time).length) setPending((p) => ({ ...p, ...time }))
    if (Object.keys(rest).length) return updateItem(occ.seriesId, rest)
  }

  async function applyPending() {
    const nid = await updateSmart(item, pending)
    setPending({})
    if (nid) open(nid)
  }

  function changeType(type: Item['type']) {
    if (type === item.type) return
    if (type === 'task') set({ type, done: false, priority: item.priority ?? 'normal', ...(item.allDay ? { due: ymd(new Date(item.start!)), start: undefined, end: undefined, allDay: undefined } : {}) })
    else if (isTimed(item)) set({ type, done: undefined })
    else {
      const d = item.due ? parseYmd(item.due) : startOfDay(new Date())
      set({ type, done: undefined, allDay: true, start: d.toISOString(), end: d.toISOString() })
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-24 md:px-10">
      <div className="flex items-start gap-3">
        {isTask && (
          <span className="pt-[12px]">
            <Checkbox checked={!!item.done} onChange={(v) => set({ done: v })} size={22} />
          </span>
        )}
        <textarea
          ref={titleRef}
          rows={1}
          value={title}
          placeholder="제목 없음"
          onChange={(e) => {
            setTitle(e.target.value)
            set({ title: e.target.value.replace(/\n/g, ' ') })
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              ;(document.querySelector('[data-note]') as HTMLTextAreaElement | null)?.focus()
            }
          }}
          className={`w-full resize-none overflow-hidden bg-transparent text-[30px] leading-[1.25] font-bold tracking-[-0.01em] outline-none md:text-[32px] ${item.done ? 'text-fg3 line-through' : ''}`}
        />
      </div>

      {occ && series?.repeat && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[8px] bg-hover px-3 py-2 text-[13px] text-fg2">
          <Icon name="repeat" size={14} />
          <span className="flex-1">
            <b className="font-medium text-fg">{repeatLabel(series.repeat, baseDate(series))}</b> 중{' '}
            {format(new Date(occ.date + 'T00:00:00'), 'M월 d일 (EEE)', { locale: ko })} 회차 · 제목·태그·메모는 모든 회차에 적용돼요
          </span>
          <button
            onClick={async () => {
              const nid = await changeOccurrence(item, {}, 'this')
              if (nid) open(nid)
            }}
            className="rounded-[4px] px-1.5 py-0.5 font-medium text-accent hover:bg-hover"
          >
            이 회차만 따로 수정
          </button>
        </div>
      )}

      {/* 속성 */}
      <div className="mt-4 flex flex-col gap-px">
        <Prop icon="type" label="유형">
          <Seg
            value={item.type}
            options={[
              ['event', '일정'],
              ['task', '할 일'],
            ]}
            onChange={(v) => (occ ? alert('반복 일정의 유형은 반복 원본에서 바꿀 수 있어요. "이 회차만 따로 수정"을 누르거나 반복을 끈 뒤 바꿔 주세요.') : changeType(v as Item['type']))}
          />
        </Prop>

        {view.type === 'event' ? <EventDates item={view} set={set} /> : <TaskDates item={view} set={set} />}

        {occ && touchesTime(pending) && (
          <div className="my-1 ml-[120px] flex flex-wrap items-center gap-2 rounded-[6px] bg-accent-soft px-2.5 py-1.5 text-[13px]">
            <span className="flex-1">날짜·시간 변경을 적용할까요?</span>
            <button onClick={() => setPending({})} className="rounded px-2 py-0.5 text-fg2 hover:bg-hover">
              취소
            </button>
            <button onClick={applyPending} className="rounded bg-accent px-2.5 py-0.5 font-medium text-white">
              적용…
            </button>
          </div>
        )}

        <Prop icon="repeat" label="반복">
          {series && <RepeatEditor item={series} onRemoved={() => occ && open(occ.seriesId)} />}
        </Prop>

        <Prop icon="folder" label="프로젝트">
          <ProjectPicker value={(series ?? item).projectId} onChange={(projectId) => set({ projectId })} />
        </Prop>

        <Prop icon="clock" label="집중 기록">
          <FocusLog itemId={item.id} />
        </Prop>

        <Prop icon="bell" label="알림">
          {series && <RemindEditor item={series} timed={!!view.start && !view.allDay} onSetup={() => setSettings(true, 'notify')} />}
        </Prop>

        {isTask && (
          <>
            <Prop icon="status" label="상태">
              <Seg
                value={statusOf(item)}
                options={(occ ? (['todo', 'done'] as Status[]) : (['todo', 'doing', 'done'] as Status[])).map((v) => [v, STATUS_LABEL[v]])}
                onChange={(v) => (occ ? set({ done: v === 'done' }) : set({ done: v === 'done', doing: v === 'doing' ? true : undefined }))}
              />
            </Prop>
            <Prop icon="flag" label="우선순위">
              <Seg
                value={item.priority ?? 'normal'}
                options={(['high', 'normal', 'low'] as Priority[]).map((p) => [p, PRIORITY_LABEL[p]])}
                onChange={(v) => set({ priority: v as Priority })}
              />
            </Prop>
          </>
        )}

        <Prop icon="hash" label="태그">
          <TagEditor item={item} suggestions={allTags(allItems).map((t) => t.tag)} set={set} />
        </Prop>

        <Prop icon="palette" label="색상">
          <div className="flex flex-wrap gap-1 px-2 py-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => set({ color: c })}
                title={COLOR_LABEL[c]}
                aria-label={COLOR_LABEL[c]}
                className={`h-5 w-5 rounded-[4px] border ${item.color === c ? 'ring-2 ring-accent ring-offset-1 ring-offset-bg' : ''}`}
                style={{ background: `var(--c-${c}-bg)`, borderColor: `var(--c-${c}-bar)` }}
              />
            ))}
          </div>
        </Prop>
      </div>

      <SubtaskEditor subtasks={(series ?? item).subtasks ?? []} onChange={(subtasks) => set({ subtasks: subtasks.length ? subtasks : undefined })} />

      <div className="my-5 border-t border-line" />
      <NoteEditor item={item} />
    </div>
  )
}

/* ───────── 속성 행 ───────── */
function Prop({ icon, label, children }: { icon: IconName; label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[34px] items-start">
      <div className="flex w-[120px] shrink-0 items-center gap-1.5 py-[7px] text-[14px] text-fg2">
        <Icon name={icon} size={15} className="text-fg3" />
        {label}
      </div>
      <div className="min-w-0 flex-1 py-[2px]">{children}</div>
    </div>
  )
}

function Seg({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 px-1 py-[3px]">
      {options.map(([v, l]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          className={`rounded-[4px] px-2 py-0.5 text-[13px] ${value === v ? 'bg-active font-medium text-fg' : 'text-fg2 hover:bg-hover'}`}
        >
          {l}
        </button>
      ))}
    </div>
  )
}

const inputCls = 'tnum rounded-[4px] bg-transparent px-2 py-1 text-[14px] outline-none hover:bg-hover focus:bg-hover'

function EventDates({ item, set }: { item: Item; set: (p: Partial<Item>) => void }) {
  const allDay = !!item.allDay
  const start = new Date(item.start ?? startOfDay(new Date()).toISOString())
  const end = new Date(item.end ?? item.start ?? start.toISOString())

  function toggleAllDay(v: boolean) {
    if (v) set({ allDay: true, start: startOfDay(start).toISOString(), end: startOfDay(end < start ? start : end).toISOString() })
    else {
      const s = startOfDay(start)
      s.setHours(9)
      set({ allDay: undefined, start: s.toISOString(), end: addMinutes(s, 60).toISOString() })
    }
  }

  return (
    <>
      <Prop icon="calendar" label="날짜">
        <div className="flex flex-col">
          {allDay ? (
            <div className="flex flex-wrap items-center gap-0.5">
              <input
                type="date"
                className={inputCls}
                value={ymd(start)}
                onChange={(e) => {
                  if (!e.target.value) return
                  const s = parseYmd(e.target.value)
                  const span = differenceInCalendarDays(end, start)
                  set({ start: s.toISOString(), end: addDays(s, Math.max(span, 0)).toISOString() })
                }}
              />
              <span className="text-fg3">→</span>
              <input
                type="date"
                className={inputCls}
                value={ymd(end)}
                min={ymd(start)}
                onChange={(e) => {
                  if (!e.target.value) return
                  const e2 = parseYmd(e.target.value)
                  set({ end: (e2 < startOfDay(start) ? startOfDay(start) : e2).toISOString() })
                }}
              />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-0.5">
              <input
                type="datetime-local"
                className={inputCls}
                value={toLocalInput(start.toISOString())}
                onChange={(e) => {
                  if (!e.target.value) return
                  const s = new Date(e.target.value)
                  const dur = end.getTime() - start.getTime()
                  set({ start: s.toISOString(), end: new Date(s.getTime() + Math.max(dur, 15 * 60000)).toISOString() })
                }}
              />
              <span className="text-fg3">→</span>
              <input
                type="datetime-local"
                className={inputCls}
                value={toLocalInput(end.toISOString())}
                onChange={(e) => {
                  if (!e.target.value) return
                  const e2 = new Date(e.target.value)
                  set({ end: (e2 <= start ? addMinutes(start, 15) : e2).toISOString() })
                }}
              />
            </div>
          )}
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-[4px] px-2 py-1 text-[13px] text-fg2 hover:bg-hover">
            <Checkbox checked={allDay} onChange={toggleAllDay} size={14} label="종일" />
            종일
          </label>
        </div>
      </Prop>
    </>
  )
}

function TaskDates({ item, set }: { item: Item; set: (p: Partial<Item>) => void }) {
  const timed = isTimed(item)
  return (
    <>
      <Prop icon="calendar" label="마감일">
        <div className="flex items-center gap-1">
          <input type="date" className={inputCls} value={item.due ?? ''} onChange={(e) => set({ due: e.target.value || undefined })} />
          {item.due && (
            <button onClick={() => set({ due: undefined })} className="grid h-6 w-6 place-items-center rounded text-fg3 hover:bg-hover" aria-label="마감일 지우기">
              <Icon name="x" size={13} />
            </button>
          )}
        </div>
      </Prop>
      <Prop icon="clock" label="시간 블록">
        {timed ? (
          <div className="flex flex-wrap items-center gap-0.5">
            <input
              type="datetime-local"
              className={inputCls}
              value={toLocalInput(item.start!)}
              onChange={(e) => {
                if (!e.target.value) return
                const s = new Date(e.target.value)
                const dur = new Date(item.end!).getTime() - new Date(item.start!).getTime()
                set({ start: s.toISOString(), end: new Date(s.getTime() + Math.max(dur, 15 * 60000)).toISOString() })
              }}
            />
            <span className="text-fg3">→</span>
            <input
              type="datetime-local"
              className={inputCls}
              value={toLocalInput(item.end!)}
              onChange={(e) => {
                if (!e.target.value) return
                const s = new Date(item.start!)
                const e2 = new Date(e.target.value)
                set({ end: (e2 <= s ? addMinutes(s, 15) : e2).toISOString() })
              }}
            />
            <button onClick={() => set({ start: undefined, end: undefined })} className="grid h-6 w-6 place-items-center rounded text-fg3 hover:bg-hover" aria-label="시간 블록 지우기">
              <Icon name="x" size={13} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => {
              const base = item.due ? parseYmd(item.due) : new Date()
              const s = new Date(base)
              const now = new Date()
              if (ymd(s) === ymd(now)) s.setHours(Math.min(now.getHours() + 1, 23), 0, 0, 0)
              else s.setHours(9, 0, 0, 0)
              set({ start: s.toISOString(), end: addMinutes(s, 30).toISOString() })
            }}
            className="rounded-[4px] px-2 py-1 text-[14px] text-fg3 hover:bg-hover"
          >
            + 시간 블록 추가 <span className="text-[12px]">(캘린더로 끌어다 놓아도 돼요)</span>
          </button>
        )}
      </Prop>
    </>
  )
}

function TagEditor({ item, suggestions, set }: { item: Item; suggestions: string[]; set: (p: Partial<Item>) => void }) {
  const [v, setV] = useState('')
  const add = () => {
    const t = v.trim().replace(/^#/, '')
    if (t && !item.tags.includes(t)) set({ tags: [...item.tags, t] })
    setV('')
  }
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-[4px] px-2 py-[3px] focus-within:bg-hover hover:bg-hover">
      {item.tags.map((t) => (
        <span key={t} className="flex items-center gap-0.5 rounded-[3px] py-px pr-0.5 pl-1.5 text-[13px]" style={colorVars(tagColor(t))}>
          {t}
          <button onClick={() => set({ tags: item.tags.filter((x) => x !== t) })} className="grid h-4 w-4 place-items-center rounded opacity-60 hover:opacity-100" aria-label={`${t} 태그 빼기`}>
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
      <input
        list="tag-suggestions"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && !v && item.tags.length) set({ tags: item.tags.slice(0, -1) })
        }}
        onBlur={add}
        placeholder={item.tags.length ? '' : '비어 있음'}
        className="min-w-[80px] flex-1 bg-transparent py-0.5 text-[14px] outline-none"
      />
      <datalist id="tag-suggestions">
        {suggestions.filter((s) => !item.tags.includes(s)).map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  )
}

/* ───────── 메모: '/' 블록 메뉴 ───────── */
const BLOCKS: { label: string; hint: string; insert: string }[] = [
  { label: '할 일 목록', hint: '- [ ]', insert: '- [ ] ' },
  { label: '제목 1', hint: '#', insert: '# ' },
  { label: '제목 2', hint: '##', insert: '## ' },
  { label: '글머리 기호 목록', hint: '-', insert: '- ' },
  { label: '번호 매기기 목록', hint: '1.', insert: '1. ' },
  { label: '인용', hint: '>', insert: '> ' },
  { label: '구분선', hint: '---', insert: '---\n' },
]

function NoteEditor({ item }: { item: Item }) {
  const [note, setNote] = useState(item.note ?? '')
  const [menu, setMenu] = useState<{ pos: number; idx: number } | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<number | null>(null)
  useEffect(() => autoGrow(ref.current, 160), [note])
  // 값이 바뀐 직후(다음 키 입력 전에) 커서 위치를 복원
  useLayoutEffect(() => {
    if (caret.current === null || !ref.current) return
    ref.current.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [note])

  const save = (v: string) => {
    setNote(v)
    updateItem(item.id, { note: v || undefined })
  }

  function pick(i: number) {
    if (!menu) return
    const b = BLOCKS[i]
    const v = note.slice(0, menu.pos) + b.insert + note.slice(menu.pos + 1)
    caret.current = menu.pos + b.insert.length
    save(v)
    setMenu(null)
    ref.current?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (menu) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setMenu({ ...menu, idx: (menu.idx + d + BLOCKS.length) % BLOCKS.length })
        return
      }
      if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
        e.preventDefault()
        pick(menu.idx)
        return
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.nativeEvent.stopImmediatePropagation()
        setMenu(null)
        return
      }
      setMenu(null)
    }
    const el = e.currentTarget
    if (e.key === '/') {
      const pos = el.selectionStart
      if (pos === 0 || note[pos - 1] === '\n') setMenu({ pos, idx: 0 })
    }
    // 목록에서 Enter → 다음 줄에 같은 기호 이어 쓰기
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      const pos = el.selectionStart
      const lineStart = note.lastIndexOf('\n', pos - 1) + 1
      const line = note.slice(lineStart, pos)
      const m = line.match(/^(\s*)(- \[[ x]\] |- |\d+\. |> )/)
      if (m) {
        e.preventDefault()
        if (line === m[0]) {
          caret.current = lineStart
          save(note.slice(0, lineStart) + note.slice(pos))
          return
        }
        let prefix = m[1] + m[2].replace('[x]', '[ ]')
        const num = m[2].match(/^(\d+)\. $/)
        if (num) prefix = `${m[1]}${Number(num[1]) + 1}. `
        caret.current = pos + 1 + prefix.length
        save(note.slice(0, pos) + '\n' + prefix + note.slice(pos))
      }
    }
  }

  const lineIdx = menu ? note.slice(0, menu.pos).split('\n').length : 0

  return (
    <div className="relative">
      <textarea
        ref={ref}
        data-note
        value={note}
        onChange={(e) => save(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => setMenu(null), 150)}
        placeholder="메모를 입력하세요. '/'를 누르면 블록 메뉴가 열려요."
        className="w-full resize-none bg-transparent text-[15px] leading-[26px] outline-none"
      />
      {menu && (
        <div className="shadow-pop absolute left-0 z-10 w-60 rounded-[8px] bg-popover py-1.5" style={{ top: lineIdx * 26 + 4 }}>
          <div className="px-3 pb-1 text-[11px] font-medium text-fg3">기본 블록</div>
          {BLOCKS.map((b, i) => (
            <button
              key={b.label}
              onMouseDown={(e) => {
                e.preventDefault()
                pick(i)
              }}
              onMouseEnter={() => setMenu({ ...menu, idx: i })}
              className={`flex w-full items-center justify-between px-3 py-1 text-left text-[14px] ${i === menu.idx ? 'bg-hover' : ''}`}
            >
              {b.label}
              <span className="font-mono text-[12px] text-fg3">{b.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function autoGrow(el: HTMLTextAreaElement | null, min = 0) {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.max(el.scrollHeight, min)}px`
}

/* ───────── 구독 캘린더 일정 (읽기 전용) ───────── */
function ReadonlyBody({ item }: { item: Item }) {
  const { open, showToast } = useUI()
  const note = item.note ?? ''
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-24 md:px-10">
      <h2 className="text-[28px] leading-[1.25] font-bold tracking-[-0.01em] break-words md:text-[30px]">{item.title}</h2>
      <div className="mt-4 flex flex-col gap-px">
        <Prop icon="calendar" label="캘린더">
          <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[14px]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: `var(--c-${item.color}-bar)` }} />
            {item.readonly!.name}
            <span className="text-[12px] text-fg3">· 구독 (읽기 전용)</span>
          </span>
        </Prop>
        <Prop icon="clock" label="날짜">
          <span className="block px-2 py-1 text-[14px]">{fmtWhen(item) || '—'}</span>
        </Prop>
        {item.repeat && (
          <Prop icon="repeat" label="반복">
            <span className="block px-2 py-1 text-[14px]">{repeatLabel(item.repeat, baseDate({ ...item, occ: undefined }))}</span>
          </Prop>
        )}
      </div>
      {note && (
        <>
          <div className="my-5 border-t border-line" />
          <p className="text-[14px] leading-relaxed whitespace-pre-wrap break-words text-fg">
            {note.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
              /^https?:\/\//.test(part) ? (
                <a key={i} href={part} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                  {part}
                </a>
              ) : (
                part
              ),
            )}
          </p>
        </>
      )}
      <div className="mt-6 flex flex-wrap items-center gap-2 rounded-[8px] bg-hover px-3 py-2.5 text-[13px] text-fg2">
        <span className="flex-1">구독한 캘린더의 일정은 여기서 바꿀 수 없어요. 원래 캘린더에서 바꾸면 다음 갱신 때 반영돼요.</span>
        <button
          onClick={async () => {
            const it = await createItem({ type: 'event', title: item.title, start: item.start, end: item.end, allDay: item.allDay, note: item.note, color: item.color })
            showToast('이 회차를 내 일정으로 복사했어요.')
            open(it.id)
          }}
          className="rounded-[6px] bg-bg px-2.5 py-1 font-medium text-fg shadow-[0_0_0_1px_var(--border-strong)] hover:bg-active"
        >
          내 일정으로 복사
        </button>
      </div>
    </div>
  )
}

/** 이 항목의 집중 기록 (반복이면 모든 회차 합) */
function FocusLog({ itemId }: { itemId: string }) {
  const list = useItemSessions(itemId)
  const [openList, setOpenList] = useState(false)
  const total = list.reduce((s, x) => s + x.minutes, 0)
  if (!list.length) return <p className="px-2 py-1 text-[13px] text-fg3">아직 없어요. 위쪽 ▶ 집중을 눌러 타이머를 시작해 보세요.</p>
  const recent = [...list].sort((a, b) => b.start.localeCompare(a.start))
  return (
    <div className="px-2 py-1 text-[13px]">
      <button onClick={() => setOpenList(!openList)} className="hover:underline">
        총 <b>{fmtMinutes(total)}</b> · {list.length}회 {openList ? '▴' : '▾'}
      </button>
      {openList && (
        <ul className="mt-1 flex flex-col gap-0.5 text-[12px] text-fg2">
          {recent.slice(0, 20).map((x) => (
            <li key={x.id} className="group flex items-center gap-2">
              <span className="tnum">{format(new Date(x.start), 'M/d HH:mm', { locale: ko })}</span>
              <span>{x.minutes}분</span>
              <button
                onClick={() => confirm('이 집중 기록을 지울까요?') && deleteSession(x.id)}
                className="invisible text-fg3 group-hover:visible hover:text-danger"
                aria-label="기록 삭제"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
