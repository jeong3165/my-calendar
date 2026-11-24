import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createItem, useItems } from '../db'
import { useUI } from '../store'
import type { Item, Section } from '../types'
import { PRIORITY_LABEL } from '../types'
import { hm, relDay, ymd } from '../lib/date'
import { colorVars, sectionTasks, tagColor, taskKey } from '../lib/items'
import { parseQuick, parsedToItem } from '../lib/parse'
import { repeatLabel } from '../lib/recur'
import { Checkbox, Icon, toggleDone } from './ui'

export const sectionTitle = (s: Section) =>
  s.kind === 'today' ? '오늘' : s.kind === 'inbox' ? '인박스' : s.kind === 'upcoming' ? '예정' : s.kind === 'done' ? '완료됨' : `#${s.tag}`

export function TaskList({ section, compact = false }: { section: Section; compact?: boolean }) {
  const items = useItems()
  const { open, selectedId } = useUI()
  const list = useMemo(() => sectionTasks(items, section), [items, section])

  return (
    <div className="flex flex-col">
      {section.kind !== 'done' && <QuickAdd section={section} />}
      {list.length === 0 ? (
        <p className="px-3 py-3 text-[13px] text-fg3">{empty(section)}</p>
      ) : (
        <ul className={compact ? '' : 'pb-2'}>
          {list.map((t) => (
            <TaskRow key={t.id} t={t} selected={t.id === selectedId} onOpen={() => open(t.id)} />
          ))}
        </ul>
      )}
    </div>
  )
}

const empty = (s: Section) =>
  s.kind === 'today' ? '오늘 할 일이 없어요.' : s.kind === 'inbox' ? '날짜 없는 할 일이 여기에 모여요.' : s.kind === 'done' ? '아직 완료한 할 일이 없어요.' : '할 일이 없어요.'

function TaskRow({ t, selected, onOpen }: { t: Item; selected: boolean; onOpen: () => void }) {
  const key = taskKey(t)
  const overdue = !t.done && !!key && key < ymd(new Date())
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-item', t.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onOpen}
      className={`group mx-1.5 flex cursor-pointer items-start gap-2 rounded-[6px] px-1.5 py-[5px] ${selected ? 'bg-active' : 'hover:bg-hover'}`}
      title="캘린더로 끌어다 놓으면 시간 블록이 됩니다"
    >
      <span className="pt-[2px]">
        <Checkbox checked={!!t.done} onChange={() => toggleDone(t)} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[14px] leading-[20px] ${t.done ? 'text-fg3 line-through' : ''}`}>{t.title || '제목 없음'}</div>
        {(key || t.priority === 'high' || t.tags.length > 0) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] leading-4 text-fg2">
            {key && (
              <span className={`tnum ${overdue ? 'text-danger' : ''}`}>
                {relDay(key)}
                {t.start && ` ${hm(new Date(t.start))}`}
              </span>
            )}
            {t.priority === 'high' && (
              <span className="flex items-center gap-0.5 text-danger">
                <Icon name="flag" size={11} />
                {PRIORITY_LABEL.high}
              </span>
            )}
            {t.tags.map((tag) => (
              <span key={tag} className="rounded-[3px] px-1 text-[11px]" style={colorVars(tagColor(tag))}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </li>
  )
}

function QuickAdd({ section }: { section: Section }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  const tick = useUI((s) => s.quickAddTick)
  useEffect(() => {
    if (tick) ref.current?.focus()
  }, [tick])

  const parsed = text.trim() ? parseQuick(text) : null

  async function submit() {
    if (!parsed || !parsed.title) return
    const patch = parsedToItem(parsed, 'task')
    if (section.kind === 'tag' && !patch.tags!.includes(section.tag)) patch.tags = [...patch.tags!, section.tag]
    if (section.kind === 'today' && !patch.due) patch.due = ymd(new Date())
    await createItem({ type: 'task', ...patch })
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return // 한글 조합 중 Enter 중복 방지
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') {
      setText('')
      ref.current?.blur()
    }
  }

  return (
    <div className="mx-1.5 mb-1">
      <label className="flex items-center gap-2 rounded-[6px] px-1.5 py-[5px] text-fg3 focus-within:bg-bg focus-within:shadow-pop hover:bg-hover">
        <Icon name="plus" size={15} />
        <input
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="할 일 추가  (예: 내일 3시 치과 #건강 !높음)"
          className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none"
        />
      </label>
      {parsed && (parsed.date || parsed.tags.length > 0 || parsed.priority || parsed.repeat) && (
        <div className="flex flex-wrap gap-1 px-2 pt-1 text-[11px] text-fg2">
          {parsed.date && (
            <span className="tnum rounded-[3px] bg-accent-soft px-1 text-accent">
              {relDay(ymd(parsed.date))}
              {parsed.start && ` ${pad(parsed.start)}`}
              {parsed.end && `–${pad(parsed.end)}`}
            </span>
          )}
          {parsed.tags.map((t) => (
            <span key={t} className="rounded-[3px] px-1" style={colorVars(tagColor(t))}>
              #{t}
            </span>
          ))}
          {parsed.priority && <span className="rounded-[3px] bg-hover px-1">우선순위 {PRIORITY_LABEL[parsed.priority]}</span>}
          {parsed.repeat && <span className="rounded-[3px] bg-hover px-1">↻ {repeatLabel(parsed.repeat, parsed.date ? ymd(parsed.date) : undefined)}</span>}
        </div>
      )}
    </div>
  )
}

const pad = (t: { h: number; m: number }) => `${String(t.h).padStart(2, '0')}:${String(t.m).padStart(2, '0')}`
