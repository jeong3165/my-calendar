import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE, type DragEvent } from 'react'
import { addDays, differenceInCalendarDays, format, isToday, startOfDay } from 'date-fns'
import { ko } from 'date-fns/locale'
import { createItem, useItems } from '../db'
import { expandItems, resolveItem, updateSmart } from '../lib/recur'
import { useUI } from '../store'
import type { Item } from '../types'
import { atMinutes, hm, ymd } from '../lib/date'
import { dayItems, layoutColumns, timedSegment, isTimed } from '../lib/items'
import { Checkbox, Icon, ItemChip, toggleDone } from './ui'

const H = 48 // 1시간 높이(px)
const SNAP = 15
const snap = (m: number) => Math.round(m / SNAP) * SNAP
const floorSnap = (m: number) => Math.floor(m / SNAP) * SNAP
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

type Drag =
  | { kind: 'create'; day: number; anchor: number; cur: number; x0: number; y0: number; moved: boolean }
  | { kind: 'move'; item: Item; day0: number; min0: number; dDay: number; dMin: number; x0: number; y0: number; moved: boolean }
  | { kind: 'resize'; item: Item; endDay: number; endMin: number }

function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])
  return now
}

export function TimeGrid({ days }: { days: Date[] }) {
  const all = useItems()
  const { open, selectedId, setDate, setView } = useUI()
  const items = useMemo(() => expandItems(all, days[0], addDays(days[days.length - 1], 1)), [all, days])
  const scrollRef = useRef<HTMLDivElement>(null)
  const colsRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [dropAt, setDropAt] = useState<{ day: number; min: number } | null>(null)
  const [allDayDrop, setAllDayDrop] = useState<number | null>(null)
  const now = useNow()
  const n = days.length
  const cols = `repeat(${n}, minmax(0, 1fr))`

  // 처음 열 때 현재 시각(또는 오전 8시) 근처로 스크롤
  const firstKey = ymd(days[0])
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const hasToday = days.some((d) => isToday(d))
    const h = hasToday ? Math.max(0, new Date().getHours() - 2) : 8
    el.scrollTop = h * H
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, n])

  function pos(clientX: number, clientY: number) {
    const r = colsRef.current!.getBoundingClientRect()
    const day = clamp(Math.floor(((clientX - r.left) / r.width) * n), 0, n - 1)
    const min = clamp(((clientY - r.top) / H) * 60, 0, 24 * 60)
    return { day, min }
  }

  /* ───── 포인터: 빈 칸 드래그 → 새 일정 / 블록 이동 / 길이 조절 ───── */
  function onGridDown(e: RPE<HTMLDivElement>) {
    if (e.button !== 0) return
    const p = pos(e.clientX, e.clientY)
    const anchor = floorSnap(p.min)
    colsRef.current!.setPointerCapture(e.pointerId)
    setDrag({ kind: 'create', day: p.day, anchor, cur: anchor + SNAP, x0: e.clientX, y0: e.clientY, moved: false })
  }

  function onBlockDown(e: RPE, item: Item, mode: 'move' | 'resize') {
    if (e.button !== 0) return
    e.stopPropagation()
    colsRef.current!.setPointerCapture(e.pointerId)
    const p = pos(e.clientX, e.clientY)
    if (mode === 'move') setDrag({ kind: 'move', item, day0: p.day, min0: p.min, dDay: 0, dMin: 0, x0: e.clientX, y0: e.clientY, moved: false })
    else setDrag({ kind: 'resize', item, endDay: p.day, endMin: snap(p.min) })
  }

  function onMove(e: RPE) {
    if (!drag) return
    const p = pos(e.clientX, e.clientY)
    const moved = Math.abs(e.clientX - (drag as { x0?: number }).x0!) + Math.abs(e.clientY - (drag as { y0?: number }).y0!) > 4
    if (drag.kind === 'create') setDrag({ ...drag, cur: snap(p.min), moved: drag.moved || moved })
    else if (drag.kind === 'move') setDrag({ ...drag, dDay: p.day - drag.day0, dMin: snap(p.min - drag.min0), moved: drag.moved || moved })
    else setDrag({ ...drag, endDay: p.day, endMin: snap(p.min) })
  }

  async function onUp() {
    const d = drag
    setDrag(null)
    if (!d) return
    if (d.kind === 'create') {
      let a: number, b: number
      if (!d.moved) {
        a = Math.floor(d.anchor / 30) * 30
        b = a + 60
      } else {
        a = Math.min(d.anchor, d.cur)
        b = Math.max(d.anchor + SNAP, d.cur)
      }
      const it = await createItem({ type: 'event', start: atMinutes(days[d.day], a).toISOString(), end: atMinutes(days[d.day], Math.min(b, 1440)).toISOString() })
      open(it.id, true)
    } else if (d.kind === 'move') {
      if (!d.moved) return open(d.item.id)
      const r = moveRange(d.item, d.dDay, d.dMin)
      const nid = await updateSmart(d.item, r)
      if (nid && selectedId === d.item.id) open(nid)
    } else {
      const r = resizeRange(d.item, days[d.endDay], d.endMin)
      await updateSmart(d.item, r)
    }
  }

  // 드래그 중인 블록의 임시 시간
  const override = useMemo(() => {
    if (!drag || drag.kind === 'create') return null
    if (drag.kind === 'move') return drag.moved ? { id: drag.item.id, ...moveRange(drag.item, drag.dDay, drag.dMin) } : null
    return { id: drag.item.id, ...resizeRange(drag.item, days[drag.endDay], drag.endMin) }
  }, [drag, days])

  const view = useMemo(() => (override ? items.map((it) => (it.id === override.id ? { ...it, start: override.start, end: override.end } : it)) : items), [items, override])

  /* ───── 사이드바 할 일 → 캘린더로 드롭 (타임 블로킹) ───── */
  function onDragOver(e: DragEvent) {
    if (!e.dataTransfer.types.includes('application/x-item')) return
    e.preventDefault()
    const p = pos(e.clientX, e.clientY)
    const min = clamp(floorSnap(p.min), 0, 1440 - SNAP)
    if (!dropAt || dropAt.day !== p.day || dropAt.min !== min) setDropAt({ day: p.day, min })
  }
  async function onDrop(e: DragEvent) {
    e.preventDefault()
    const id = e.dataTransfer.getData('application/x-item')
    const at = dropAt
    setDropAt(null)
    const it = resolveItem(all, id)
    if (!it || !at) return
    const dur = isTimed(it) ? new Date(it.end!).getTime() - new Date(it.start!).getTime() : (it.type === 'task' ? 30 : 60) * 60000
    const s = atMinutes(days[at.day], at.min)
    await updateSmart(it, { start: s.toISOString(), end: new Date(s.getTime() + dur).toISOString(), allDay: undefined })
  }

  async function onAllDayDrop(e: DragEvent, day: Date) {
    e.preventDefault()
    setAllDayDrop(null)
    const id = e.dataTransfer.getData('application/x-item')
    const it = resolveItem(all, id)
    if (!it) return
    if (it.type === 'task') await updateSmart(it, { due: ymd(day), start: undefined, end: undefined, allDay: undefined })
    else {
      const span = it.allDay && it.start && it.end ? differenceInCalendarDays(new Date(it.end), new Date(it.start)) : 0
      await updateSmart(it, { allDay: true, start: startOfDay(day).toISOString(), end: addDays(startOfDay(day), span).toISOString() })
    }
  }

  const perDay = days.map((d) => dayItems(view, d))
  const nowMin = now.getHours() * 60 + now.getMinutes()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 요일 헤더 */}
      <div className="flex border-b border-line [scrollbar-gutter:stable] overflow-y-hidden">
        <div className="w-16 shrink-0" />
        <div className="grid flex-1" style={{ gridTemplateColumns: cols }}>
          {days.map((d) => {
            const today = isToday(d)
            return (
              <button
                key={d.toISOString()}
                onClick={() => {
                  setDate(d)
                  setView('day')
                }}
                className="flex items-center justify-center gap-1.5 py-2 text-[13px] hover:bg-hover"
              >
                <span className={today ? 'text-accent' : 'text-fg2'}>{format(d, 'EEE', { locale: ko })}</span>
                <span
                  className={`tnum grid h-6 min-w-6 place-items-center rounded-full px-1 font-semibold ${today ? 'bg-accent text-white' : 'text-fg'}`}
                >
                  {format(d, 'd')}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* 종일 영역 */}
      <div className="flex border-b border-line [scrollbar-gutter:stable] overflow-y-hidden">
        <div className="flex w-16 shrink-0 items-start justify-end pt-1.5 pr-2 text-[11px] text-fg3">종일</div>
        <div className="grid flex-1" style={{ gridTemplateColumns: cols }}>
          {days.map((d, i) => (
            <div
              key={d.toISOString()}
              className={`flex max-h-28 min-h-8 flex-col gap-0.5 overflow-y-auto border-l border-line p-0.5 ${allDayDrop === i ? 'bg-accent-soft' : ''}`}
              onDoubleClick={async () => {
                const it = await createItem({ type: 'event', allDay: true, start: startOfDay(d).toISOString(), end: startOfDay(d).toISOString() })
                open(it.id, true)
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('application/x-item')) return
                e.preventDefault()
                setAllDayDrop(i)
              }}
              onDragLeave={() => setAllDayDrop(null)}
              onDrop={(e) => onAllDayDrop(e, d)}
            >
              {perDay[i].allDay.map((it) => (
                <ItemChip key={it.id} item={it} selected={it.id === selectedId} onOpen={() => open(it.id)} />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* 시간 그리드 */}
      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="flex" style={{ height: 24 * H }}>
          <div className="relative w-16 shrink-0">
            {Array.from({ length: 23 }, (_, i) => i + 1).map((h) => (
              <div key={h} className="tnum absolute right-2 -translate-y-1/2 text-[11px] whitespace-nowrap text-fg3" style={{ top: h * H }}>
                {h < 12 ? `오전 ${h}시` : h === 12 ? '오후 12시' : `오후 ${h - 12}시`}
              </div>
            ))}
          </div>
          <div
            ref={colsRef}
            className="relative grid flex-1 touch-pan-y select-none"
            style={{
              gridTemplateColumns: cols,
              backgroundImage: 'linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
              backgroundSize: `100% ${H}px`,
            }}
            onPointerDown={onGridDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={() => setDrag(null)}
            onDragOver={onDragOver}
            onDragLeave={(e) => {
              if (!colsRef.current?.contains(e.relatedTarget as Node)) setDropAt(null)
            }}
            onDrop={onDrop}
          >
            {days.map((d, i) => {
              const segs = perDay[i].timed.map((it) => ({ it, ...timedSegment(it, d)! }))
              const lay = layoutColumns(segs.map((s) => ({ id: s.it.id, startMin: s.startMin, endMin: s.endMin })))
              const today = isToday(d)
              return (
                <div key={d.toISOString()} className="relative border-l border-line">
                  {segs.map(({ it, startMin, endMin }) => {
                    const { col, cols: c } = lay.get(it.id)!
                    const height = Math.max(((endMin - startMin) / 60) * H - 2, 18)
                    const dragging = override?.id === it.id
                    return (
                      <div
                        key={it.id}
                        data-block
                        onPointerDown={(e) => onBlockDown(e, it, 'move')}
                        className={`absolute overflow-hidden rounded-[4px] px-1.5 py-[3px] text-[12px] leading-tight ${
                          dragging ? 'z-20 opacity-90 shadow-pop' : 'z-10'
                        } ${it.id === selectedId ? 'ring-2 ring-accent' : ''} cursor-pointer`}
                        style={{
                          top: (startMin / 60) * H + 1,
                          height,
                          left: `calc(${(col / c) * 100}% + 2px)`,
                          width: `calc(${100 / c}% - 4px)`,
                          background: `var(--c-${it.color}-bg)`,
                          color: `var(--c-${it.color}-text)`,
                          boxShadow: `inset 3px 0 0 var(--c-${it.color}-bar)`,
                          paddingLeft: 8,
                        }}
                      >
                        <div className="flex min-w-0 items-start gap-1">
                          {it.type === 'task' && (
                            <span className="mt-px">
                              <Checkbox checked={!!it.done} onChange={() => toggleDone(it)} size={13} />
                            </span>
                          )}
                          <span className={`min-w-0 font-medium ${height < 30 ? 'truncate' : 'line-clamp-2'} ${it.done ? 'line-through opacity-60' : ''}`}>
                            {it.occ && <Icon name="repeat" size={10} className="mr-0.5 inline opacity-60" />}
                            {it.title || '제목 없음'}
                            {height < 30 && <span className="tnum ml-1 font-normal opacity-70">{hm(new Date(it.start!))}</span>}
                          </span>
                        </div>
                        {height >= 30 && (
                          <div className="tnum mt-0.5 truncate opacity-70">
                            {hm(new Date(it.start!))} – {hm(new Date(it.end!))}
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" onPointerDown={(e) => onBlockDown(e, it, 'resize')} />
                      </div>
                    )
                  })}

                  {/* 새 일정 드래그 미리보기 */}
                  {drag?.kind === 'create' && drag.day === i && drag.moved && (
                    <Ghost a={Math.min(drag.anchor, drag.cur)} b={Math.max(drag.anchor + SNAP, drag.cur)} label="새 일정" />
                  )}
                  {/* 할 일 드롭 미리보기 */}
                  {dropAt?.day === i && <Ghost a={dropAt.min} b={dropAt.min + 30} label={`${fmtMin(dropAt.min)}에 배치`} />}

                  {/* 현재 시각 */}
                  {today && (
                    <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: (nowMin / 60) * H }}>
                      <div className="absolute -top-[4.5px] -left-[5px] h-[9px] w-[9px] rounded-full bg-danger" />
                      <div className="h-[2px] bg-danger" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

function Ghost({ a, b, label }: { a: number; b: number; label: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-[2px] z-20 rounded-[4px] border border-accent bg-accent-soft px-1.5 py-[3px] text-[12px] text-accent"
      style={{ top: (a / 60) * H + 1, height: Math.max(((b - a) / 60) * H - 2, 16) }}
    >
      <span className="tnum font-medium">
        {label} {label === '새 일정' && `${fmtMin(a)} – ${fmtMin(Math.min(b, 1440))}`}
      </span>
    </div>
  )
}

function moveRange(it: Item, dDay: number, dMin: number) {
  const s = new Date(it.start!)
  const e = new Date(it.end!)
  const off = dDay * 1440 + dMin
  // 일광절약시간이 없는 한국 기준이므로 분 단위로 단순 이동
  return { start: new Date(s.getTime() + off * 60000).toISOString(), end: new Date(e.getTime() + off * 60000).toISOString() }
}

function resizeRange(it: Item, day: Date, endMin: number) {
  const s = new Date(it.start!)
  let e = atMinutes(day, endMin)
  if (e.getTime() < s.getTime() + SNAP * 60000) e = new Date(s.getTime() + SNAP * 60000)
  return { start: it.start!, end: e.toISOString() }
}

