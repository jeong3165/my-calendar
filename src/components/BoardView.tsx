import { useMemo, useState, type DragEvent, type KeyboardEvent } from 'react'
import { createItem, useItems } from '../db'
import { useUI } from '../store'
import { PRIORITY_LABEL, STATUS_LABEL, type Item, type Priority, type Status } from '../types'
import { applyFilters, setStatus, sortRows, statusOf, toRows } from '../lib/dbview'
import { colorVars, tagColor } from '../lib/items'
import { parseQuick, parsedToItem } from '../lib/parse'
import { resolveItem, updateSmart } from '../lib/recur'
import { Checkbox, Icon, toggleDone } from './ui'
import { fmtWhen, isOverdue, PRIORITY_COLOR, STATUS_COLOR } from './viewUtil'

type Col = { key: string; label: string; color: string; match: (it: Item) => boolean; patch: () => Partial<Item> }

const MAX_DONE = 30

export function BoardView() {
  const { filters, boardGroup, open, selectedId, showToast } = useUI()
  const items = useItems()
  const [over, setOver] = useState<string | null>(null)
  const [showAllDone, setShowAllDone] = useState(false)

  const rows = useMemo(
    () => sortRows(sortRows(applyFilters(toRows(items), { ...filters, type: 'task' }), { key: 'priority', dir: 'asc' }), { key: 'date', dir: 'asc' }),
    [items, filters],
  )

  const cols: Col[] =
    boardGroup === 'status'
      ? (['todo', 'doing', 'done'] as Status[]).map((s) => ({
          key: s,
          label: STATUS_LABEL[s],
          color: STATUS_COLOR[s],
          match: (it) => statusOf(it) === s,
          patch: () => ({ done: s === 'done', doing: s === 'doing' ? true : undefined }),
        }))
      : (['high', 'normal', 'low'] as Priority[]).map((p) => ({
          key: p,
          label: `우선순위 ${PRIORITY_LABEL[p]}`,
          color: PRIORITY_COLOR[p],
          match: (it) => (it.priority ?? 'normal') === p,
          patch: () => ({ priority: p }),
        }))

  async function onDrop(e: DragEvent, col: Col) {
    e.preventDefault()
    setOver(null)
    const it = resolveItem(items, e.dataTransfer.getData('application/x-item'))
    if (!it || col.match(it)) return
    if (boardGroup === 'status') {
      const err = await setStatus(it, col.key as Status)
      if (err) showToast(err)
    } else await updateSmart(it, { priority: col.key as Priority })
  }

  return (
    <div className="flex min-h-0 flex-1 snap-x gap-3 overflow-x-auto px-4 pt-1 pb-6 md:px-6">
      {cols.map((col) => {
        let list = rows.filter(col.match)
        const total = list.length
        if (col.key === 'done') list = sortRows(list, { key: 'updated', dir: 'desc' })
        const hidden = col.key === 'done' && !showAllDone ? Math.max(0, total - MAX_DONE) : 0
        if (hidden) list = list.slice(0, MAX_DONE)
        return (
          <section
            key={col.key}
            aria-label={col.label}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('application/x-item')) return
              e.preventDefault()
              if (over !== col.key) setOver(col.key)
            }}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
            onDrop={(e) => onDrop(e, col)}
            className={`flex w-[280px] shrink-0 snap-start flex-col rounded-[10px] p-1.5 transition-colors md:w-[300px] ${over === col.key ? 'bg-accent-soft' : 'bg-sidebar'}`}
          >
            <header className="flex items-center gap-2 px-1.5 pt-1 pb-2">
              <span className="rounded-[4px] px-1.5 py-px text-[13px] font-medium" style={colorVars(col.color as never)}>
                {col.label}
              </span>
              <span className="tnum text-[13px] text-fg3">{total}</span>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
              {list.map((it) => (
                <Card key={it.id} it={it} selected={it.id === selectedId} onOpen={() => open(it.id)} showPriority={boardGroup === 'status'} />
              ))}
              {hidden > 0 && (
                <button onClick={() => setShowAllDone(true)} className="rounded-[6px] px-2 py-1.5 text-left text-[13px] text-fg2 hover:bg-hover">
                  완료 {hidden}개 더 보기
                </button>
              )}
              <AddCard patch={col.patch} />
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Card({ it, selected, onOpen, showPriority }: { it: Item; selected: boolean; onOpen: () => void; showPriority: boolean }) {
  const when = fmtWhen(it)
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-item', it.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={onOpen}
      className={`cursor-pointer rounded-[8px] border bg-bg px-2.5 py-2 shadow-[0_1px_2px_rgba(15,15,15,0.06)] hover:bg-[color-mix(in_srgb,var(--bg)_94%,var(--text))] ${
        selected ? 'border-accent ring-1 ring-accent' : 'border-line'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="pt-[3px]">
          <Checkbox checked={!!it.done} onChange={() => toggleDone(it)} size={14} />
        </span>
        <span className={`min-w-0 flex-1 text-[14px] leading-snug font-medium break-words ${it.done ? 'text-fg3 line-through' : ''}`}>{it.title || '제목 없음'}</span>
      </div>
      {(when || it.tags.length > 0 || it.occ || (showPriority && it.priority === 'high')) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-[22px] text-[12px]">
          {when && <span className={`tnum ${isOverdue(it) ? 'text-danger' : 'text-fg2'}`}>{when}</span>}
          {it.occ && <Icon name="repeat" size={12} className="text-fg3" />}
          {showPriority && it.priority === 'high' && (
            <span className="flex items-center gap-0.5 text-danger">
              <Icon name="flag" size={11} />
              높음
            </span>
          )}
          {it.tags.map((t) => (
            <span key={t} className="rounded-[3px] px-1.5" style={colorVars(tagColor(t))}>
              {t}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

function AddCard({ patch }: { patch: () => Partial<Item> }) {
  const [text, setText] = useState('')
  async function add() {
    const p = parseQuick(text)
    if (!p.title) return
    await createItem({ type: 'task', ...parsedToItem(p, 'task'), ...patch() })
    setText('')
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') void add()
    if (e.key === 'Escape') setText('')
  }
  return (
    <label className="flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-fg3 focus-within:bg-bg focus-within:shadow-pop hover:bg-hover">
      <Icon name="plus" size={14} />
      <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="새로 만들기" className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none" />
    </label>
  )
}
