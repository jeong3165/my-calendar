import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { addDays, addMinutes, differenceInCalendarDays, startOfDay } from 'date-fns'
import { deleteItem, updateItem, useItems } from '../db'
import { useUI } from '../store'
import type { Item, Priority } from '../types'
import { COLORS, COLOR_LABEL, PRIORITY_LABEL } from '../types'
import { parseYmd, toLocalInput, ymd } from '../lib/date'
import { allTags, colorVars, isTimed, tagColor } from '../lib/items'
import { Checkbox, Icon, type IconName } from './ui'

export function PeekPanel() {
  const { selectedId, close, isMobile } = useUI()
  const items = useItems()
  const item = items.find((i) => i.id === selectedId)
  if (!item) return null
  return (
    <aside
      className={`flex min-h-0 flex-col bg-bg ${isMobile ? 'fixed inset-0 z-50' : 'w-[440px] shrink-0 border-l border-line xl:w-[480px]'}`}
      aria-label="상세 보기"
    >
      <div className="flex items-center gap-1 px-3 py-2">
        <button onClick={close} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기" title="닫기 (Esc)">
          <Icon name={isMobile ? 'x' : 'collapse'} size={16} className={isMobile ? '' : 'rotate-180'} />
        </button>
        <span className="text-[13px] text-fg3">{item.type === 'event' ? '일정' : '할 일'}</span>
        <div className="flex-1" />
        <button
          onClick={async () => {
            if (!confirm(`'${item.title || '제목 없음'}'을(를) 삭제할까요?`)) return
            close()
            await deleteItem(item.id)
          }}
          className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[13px] text-fg2 hover:bg-hover hover:text-danger"
        >
          <Icon name="trash" size={15} /> 삭제
        </button>
      </div>
      <PeekBody key={item.id} item={item} allItems={items} />
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

  const set = (patch: Partial<Item>) => updateItem(item.id, patch)

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

      {/* 속성 */}
      <div className="mt-4 flex flex-col gap-px">
        <Prop icon="type" label="유형">
          <Seg
            value={item.type}
            options={[
              ['event', '일정'],
              ['task', '할 일'],
            ]}
            onChange={(v) => changeType(v as Item['type'])}
          />
        </Prop>

        {item.type === 'event' ? <EventDates item={item} set={set} /> : <TaskDates item={item} set={set} />}

        {isTask && (
          <>
            <Prop icon="status" label="상태">
              <button onClick={() => set({ done: !item.done })} className="flex items-center gap-1.5 rounded-[4px] px-2 py-1 hover:bg-hover">
                <span className={`h-2 w-2 rounded-full ${item.done ? 'bg-[var(--c-green-bar)]' : 'bg-[var(--c-gray-bar)]'}`} />
                <span className="text-[14px]">{item.done ? '완료' : '할 일'}</span>
              </button>
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
