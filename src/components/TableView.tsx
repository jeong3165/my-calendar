import { useMemo, useState, type KeyboardEvent } from 'react'
import { createItem, useItems } from '../db'
import { useUI } from '../store'
import { PRIORITY_LABEL, STATUS_LABEL, type Item, type Priority, type Status } from '../types'
import { applyFilters, setStatus, sortRows, statusOf, toRows, type SortKey } from '../lib/dbview'
import { colorVars, tagColor } from '../lib/items'
import { parseQuick, parsedToItem } from '../lib/parse'
import { repeatLabel, baseDate, updateSmart } from '../lib/recur'
import { SORT_LABEL } from './FilterBar'
import { ago } from './SettingsDialog'
import { Checkbox, Icon, toggleDone } from './ui'
import { fmtWhen, isOverdue, PRIORITY_COLOR, STATUS_COLOR } from './viewUtil'

const COLS: { key: SortKey; w: string }[] = [
  { key: 'title', w: 'min-w-[260px] w-[34%]' },
  { key: 'type', w: 'w-[80px]' },
  { key: 'date', w: 'w-[190px]' },
  { key: 'status', w: 'w-[110px]' },
  { key: 'priority', w: 'w-[100px]' },
  { key: 'tags', w: 'w-[170px]' },
  { key: 'updated', w: 'w-[96px]' },
]

export function TableView() {
  const { filters, sort, setSort, open, selectedId, showToast } = useUI()
  const items = useItems()
  const rows = useMemo(() => sortRows(applyFilters(toRows(items), filters), sort), [items, filters, sort])

  const head = (key: SortKey) => (
    <button
      onClick={() => setSort({ key, dir: sort.key === key && sort.dir === 'asc' ? 'desc' : 'asc' })}
      className="flex w-full items-center gap-1 px-2 py-1.5 text-left font-normal hover:bg-hover"
    >
      {SORT_LABEL[key]}
      {sort.key === key && <span className="text-fg3">{sort.dir === 'asc' ? '↑' : '↓'}</span>}
    </button>
  )

  return (
    <div className="min-h-0 flex-1 overflow-auto px-2 pb-24 md:px-6">
      <table className="w-full min-w-[980px] border-collapse text-[14px]">
        <thead className="sticky top-0 z-10 bg-bg text-[13px] text-fg2">
          <tr className="border-b border-line">
            <th className="w-9" />
            {COLS.map((c) => (
              <th key={c.key} className={`${c.w} border-l border-line p-0 first-of-type:border-l-0`}>
                {head(c.key)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((it) => (
            <Row key={it.id} it={it} selected={it.id === selectedId} onOpen={() => open(it.id)} onError={showToast} />
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p className="px-3 py-6 text-[14px] text-fg3">조건에 맞는 항목이 없어요.</p>}
      <NewRow />
      <p className="px-3 pt-1 text-[12px] text-fg3">
        {rows.length}개 · 반복 항목은 오늘 또는 다음 회차가 보여요 · 제목을 누르면 자세히 볼 수 있어요
      </p>
    </div>
  )
}

function Row({ it, selected, onOpen, onError }: { it: Item; selected: boolean; onOpen: () => void; onError: (m: string) => void }) {
  const task = it.type === 'task'
  const series = it.occ ? undefined : it
  const rep = it.repeat ? repeatLabel(it.repeat, it.occ ? undefined : baseDate(series ?? it)) : ''
  return (
    <tr className={`group border-b border-line ${selected ? 'bg-accent-soft' : 'hover:bg-hover'}`}>
      <td className="px-2 text-center align-middle">
        {task ? (
          <span className="inline-grid place-items-center">
            <Checkbox checked={!!it.done} onChange={() => toggleDone(it)} size={15} />
          </span>
        ) : (
          <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: `var(--c-${it.color}-bar)` }} />
        )}
      </td>
      <td className="border-l border-line p-0">
        <button onClick={onOpen} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left">
          <span className={`truncate font-medium ${it.done ? 'text-fg3 line-through' : ''}`}>{it.title || '제목 없음'}</span>
          {rep && (
            <span className="flex shrink-0 items-center gap-0.5 text-[12px] text-fg3" title={rep}>
              <Icon name="repeat" size={12} />
            </span>
          )}
          {it.note && <Icon name="text" size={12} className="shrink-0 text-fg3" />}
          <span className="ml-auto hidden shrink-0 rounded-[4px] border border-line-strong bg-bg px-1.5 text-[11px] text-fg2 group-hover:inline">열기</span>
        </button>
      </td>
      <td className="border-l border-line px-2 text-[13px] text-fg2">{task ? '할 일' : '일정'}</td>
      <td className={`tnum border-l border-line px-2 text-[13px] ${isOverdue(it) ? 'text-danger' : ''}`}>{fmtWhen(it) || <span className="text-fg3">—</span>}</td>
      <td className="border-l border-line px-1">
        {task ? (
          <SelectChip
            value={statusOf(it)}
            options={(['todo', 'doing', 'done'] as Status[]).map((s) => [s, STATUS_LABEL[s], STATUS_COLOR[s]])}
            onChange={async (v) => {
              const err = await setStatus(it, v as Status)
              if (err) onError(err)
            }}
          />
        ) : (
          <span className="px-1 text-fg3">—</span>
        )}
      </td>
      <td className="border-l border-line px-1">
        {task ? (
          <SelectChip
            value={it.priority ?? 'normal'}
            options={(['high', 'normal', 'low'] as Priority[]).map((p) => [p, PRIORITY_LABEL[p], PRIORITY_COLOR[p]])}
            onChange={(v) => void updateSmart(it, { priority: v as Priority })}
          />
        ) : (
          <span className="px-1 text-fg3">—</span>
        )}
      </td>
      <td className="border-l border-line px-2">
        <div className="flex flex-wrap gap-1 py-1">
          {it.tags.map((t) => (
            <span key={t} className="rounded-[3px] px-1.5 text-[12px]" style={colorVars(tagColor(t))}>
              {t}
            </span>
          ))}
        </div>
      </td>
      <td className="border-l border-line px-2 text-[12px] whitespace-nowrap text-fg3">{ago(it.updatedAt)}</td>
    </tr>
  )
}

/** 노션식 선택 칩: 겉은 색 칩, 실제로는 select */
function SelectChip({ value, options, onChange }: { value: string; options: [string, string, string][]; onChange: (v: string) => void }) {
  const cur = options.find(([v]) => v === value)!
  return (
    <label className="relative inline-flex cursor-pointer items-center rounded-[4px] px-1 py-0.5 hover:bg-hover">
      <span className="rounded-[4px] px-1.5 py-px text-[12px]" style={colorVars(cur[2] as never)}>
        {cur[1]}
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="값 바꾸기">
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}

/** 맨 아래 "+ 새로 만들기" (빠른 입력 문법 그대로) */
function NewRow() {
  const type = useUI((s) => s.filters.type)
  const [text, setText] = useState('')
  async function add() {
    const p = parseQuick(text)
    if (!p.title) return
    const t = type === 'event' ? 'event' : 'task'
    await createItem({ type: t, ...parsedToItem(p, t) })
    setText('')
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter') void add()
    if (e.key === 'Escape') setText('')
  }
  return (
    <label className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-fg3 focus-within:bg-hover hover:bg-hover">
      <Icon name="plus" size={15} />
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        placeholder={type === 'event' ? '새 일정 (예: 금요일 7시 저녁 약속)' : '새로 만들기 (예: 내일 3시 보고서 #회사 !높음)'}
        className="min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none"
      />
    </label>
  )
}
