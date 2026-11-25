import type { ReactNode } from 'react'
import type { Item } from '../types'
import { updateItem } from '../db'
import { colorVars, isTimed } from '../lib/items'
import { hm } from '../lib/date'
import { toggleOccurrenceDone } from '../lib/recur'
import { startFocus } from '../lib/timer'

/* ───────── 아이콘 (선 아이콘, 1.8px) ───────── */
const P: Record<string, ReactNode> = {
  left: <path d="m15 18-6-6 6-6" />,
  right: <path d="m9 18 6-6-6-6" />,
  plus: <path d="M5 12h14M12 5v14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  sidebar: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </>
  ),
  collapse: <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  today: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
      <circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </>
  ),
  inbox: (
    <>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  upcoming: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  done: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  hash: <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />,
  trash: <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  upload: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />,
  flag: <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" />,
  text: <path d="M21 6H3M15 12H3M17 18H3" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  status: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none" />
    </>
  ),
  type: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  palette: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="8" cy="10" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="16" cy="10" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  repeat: <path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" />,
  bell: <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />,
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18M9 10v10" />
    </>
  ),
  board: (
    <>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="10" y="4" width="5" height="11" rx="1.5" />
      <rect x="17" y="4" width="4" height="7" rx="1.5" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  sort: <path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4" />,
  sparkle: <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />,
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </>
  ),
  settings: (
    <>
      <path d="M12.2 2h-.4a2 2 0 0 0-2 2v.2a2 2 0 0 1-1 1.7l-.4.3a2 2 0 0 1-2 0l-.2-.1a2 2 0 0 0-2.7.7l-.2.4a2 2 0 0 0 .7 2.7l.2.1a2 2 0 0 1 1 1.7v.5a2 2 0 0 1-1 1.7l-.2.1a2 2 0 0 0-.7 2.7l.2.4a2 2 0 0 0 2.7.7l.2-.1a2 2 0 0 1 2 0l.4.3a2 2 0 0 1 1 1.7v.2a2 2 0 0 0 2 2h.4a2 2 0 0 0 2-2v-.2a2 2 0 0 1 1-1.7l.4-.3a2 2 0 0 1 2 0l.2.1a2 2 0 0 0 2.7-.7l.2-.4a2 2 0 0 0-.7-2.7l-.2-.1a2 2 0 0 1-1-1.7v-.5a2 2 0 0 1 1-1.7l.2-.1a2 2 0 0 0 .7-2.7l-.2-.4a2 2 0 0 0-2.7-.7l-.2.1a2 2 0 0 1-2 0l-.4-.3a2 2 0 0 1-1-1.7V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
}
export type IconName = keyof typeof P

export function Icon({ name, size = 16, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {P[name]}
    </svg>
  )
}

/* ───────── 노션식 체크박스 ───────── */
export function Checkbox({ checked, onChange, size = 16, label }: { checked: boolean; onChange: (v: boolean) => void; size?: number; label?: string }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label ?? (checked ? '완료 취소' : '완료')}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={`grid shrink-0 place-items-center rounded-[3px] border transition-colors ${
        checked ? 'border-accent bg-accent text-white' : 'border-fg2/60 hover:bg-hover'
      }`}
      style={{ width: size, height: size, borderWidth: 1.5 }}
    >
      {checked && (
        <svg width={size - 4} height={size - 4} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="m2.5 6.2 2.3 2.3 4.7-5" />
        </svg>
      )}
    </button>
  )
}

export const toggleDone = (it: Item) => (it.occ ? toggleOccurrenceDone(it) : updateItem(it.id, { done: !it.done }))

/* ───────── 월간/종일 영역 칩 ───────── */
export function ItemChip({
  item,
  onOpen,
  selected,
  showTime = true,
}: {
  item: Item
  onOpen: () => void
  selected?: boolean
  showTime?: boolean
}) {
  const timed = isTimed(item)
  const solid = item.type === 'event' && !timed
  return (
    <div
      draggable={!item.readonly}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-item', item.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      title={item.title || '제목 없음'}
      className={`flex h-[22px] min-w-0 cursor-pointer items-center gap-1.5 rounded-[4px] px-1.5 text-[12px] leading-none select-none ${
        selected ? 'ring-2 ring-accent' : ''
      } ${solid ? '' : 'hover:bg-hover'}`}
      style={solid ? colorVars(item.color) : undefined}
    >
      {item.type === 'task' ? (
        <Checkbox checked={!!item.done} onChange={() => toggleDone(item)} size={13} />
      ) : (
        !solid && <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: `var(--c-${item.color}-bar)` }} />
      )}
      {timed && showTime && <span className="tnum shrink-0 text-fg2">{hm(new Date(item.start!))}</span>}
      <span className={`truncate ${item.done ? 'text-fg3 line-through' : ''} ${solid ? 'font-medium' : ''}`}>{item.title || '제목 없음'}</span>
      {item.occ && <Icon name="repeat" size={11} className="opacity-50" />}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line-strong px-1 py-px font-sans text-[11px] text-fg3">{children}</kbd>
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl'

/** ▶ 집중 시작 (작은 버튼) */
export function FocusButton({ item, label = false, className = '' }: { item: Pick<Item, 'id' | 'title'>; label?: boolean; className?: string }) {
  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        void startFocus(item)
      }}
      title="이 항목에 집중 시작 (타이머)"
      aria-label="집중 시작"
      className={`flex shrink-0 items-center gap-1 rounded-[4px] text-fg3 hover:bg-hover hover:text-danger ${label ? 'h-7 px-2 text-[13px] text-fg2' : 'h-6 w-6 justify-center'} ${className}`}
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
        <path d="M3 1.8v8.4a.6.6 0 0 0 .9.5l6.6-4.2a.6.6 0 0 0 0-1L3.9 1.3a.6.6 0 0 0-.9.5z" />
      </svg>
      {label && '집중'}
    </button>
  )
}
