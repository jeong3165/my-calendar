import { useEffect, useMemo, useRef, useState } from 'react'
import { useItems } from '../db'
import { useUI } from '../store'
import { PRIORITY_LABEL, type Priority } from '../types'
import { allTags, colorVars, tagColor } from '../lib/items'
import { PERIOD_LABEL, isFiltered, type Period, type SortKey } from '../lib/dbview'
import { Icon } from './ui'
import { useProjects } from '../lib/projects'

export const SORT_LABEL: Record<SortKey, string> = {
  title: '제목',
  type: '유형',
  date: '날짜',
  status: '상태',
  priority: '우선순위',
  project: '프로젝트',
  tags: '태그',
  updated: '수정일',
}

const chip = (on: boolean) => `rounded-[4px] px-2 py-0.5 text-[13px] ${on ? 'bg-active font-medium text-fg' : 'text-fg2 hover:bg-hover'}`

/** 표·보드 위의 검색 / 필터 / 정렬(표) / 그룹(보드) */
export function FilterBar() {
  const { mode, filters: f, setFilters, resetFilters, sort, setSort, boardGroup, setBoardGroup, isMobile } = useUI()
  const items = useItems()
  const tags = useMemo(() => allTags(items), [items])
  const projects = useProjects()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const active = isFiltered(f) || (mode === 'table' && f.type !== 'all')
  const count = [f.q.trim(), f.tags.length, f.projects?.length, f.priorities.length, f.period !== 'all', f.hideDone, mode === 'table' && f.type !== 'all'].filter(Boolean).length

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  return (
    <>
      <label className="flex h-7 shrink-0 items-center gap-1.5 rounded-[6px] px-2 text-fg3 focus-within:bg-hover hover:bg-hover">
        <Icon name="search" size={14} />
        <input
          value={f.q}
          onChange={(e) => setFilters({ q: e.target.value })}
          placeholder="검색"
          className="w-24 bg-transparent text-[13px] text-fg outline-none focus:w-36 max-md:w-14 max-md:focus:w-28 sm:w-28"
        />
      </label>

      <div ref={box} className="relative shrink-0">
        <button
          onClick={() => setOpen(!open)}
          className={`flex h-7 items-center gap-1 whitespace-nowrap rounded-[6px] px-2 text-[13px] ${active ? 'bg-accent-soft font-medium text-accent' : 'text-fg2 hover:bg-hover'}`}
          aria-expanded={open}
        >
          <Icon name="filter" size={14} />
          필터{count > 0 && ` ${count}`}
        </button>
        {open && (
          <div className="shadow-pop absolute right-0 z-40 mt-1 flex w-[300px] max-md:fixed max-md:inset-x-3 max-md:top-24 max-md:w-auto flex-col gap-3 rounded-[10px] bg-popover p-3 text-[13px]">
            {mode === 'table' && (
              <Section label="유형">
                {(
                  [
                    ['all', '전체'],
                    ['event', '일정'],
                    ['task', '할 일'],
                  ] as const
                ).map(([v, l]) => (
                  <button key={v} onClick={() => setFilters({ type: v })} className={chip(f.type === v)}>
                    {l}
                  </button>
                ))}
              </Section>
            )}
            <Section label="기간">
              {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
                <button key={p} onClick={() => setFilters({ period: p })} className={chip(f.period === p)}>
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </Section>
            <Section label="우선순위 (할 일)">
              {(['high', 'normal', 'low'] as Priority[]).map((p) => (
                <button key={p} onClick={() => setFilters({ priorities: toggle(f.priorities, p) })} className={chip(f.priorities.includes(p))}>
                  {PRIORITY_LABEL[p]}
                </button>
              ))}
            </Section>
            {projects.length > 0 && (
              <Section label="프로젝트">
                {[...projects.filter((p) => !p.done).map((p) => [p.id, `${p.icon ?? '📁'} ${p.title || '이름 없음'}`] as const), ['none', '프로젝트 없음'] as const].map(([id, l]) => (
                  <button key={id} onClick={() => setFilters({ projects: toggle(f.projects ?? [], id) })} className={chip((f.projects ?? []).includes(id))}>
                    {l}
                  </button>
                ))}
              </Section>
            )}
            {tags.length > 0 && (
              <Section label="태그 (하나라도 있으면)">
                {tags.map(({ tag }) => (
                  <button
                    key={tag}
                    onClick={() => setFilters({ tags: toggle(f.tags, tag) })}
                    className={`rounded-[4px] px-1.5 py-0.5 text-[12px] ${f.tags.includes(tag) ? 'ring-2 ring-accent' : 'opacity-80 hover:opacity-100'}`}
                    style={colorVars(tagColor(tag))}
                  >
                    {tag}
                  </button>
                ))}
              </Section>
            )}
            <label className="flex cursor-pointer items-center gap-2">
              <input type="checkbox" checked={f.hideDone} onChange={(e) => setFilters({ hideDone: e.target.checked })} className="accent-[var(--accent)]" />
              완료한 할 일 숨기기
            </label>
            {count > 0 && (
              <button onClick={() => (resetFilters(), mode === 'table' && setFilters({ type: 'all' }))} className="self-start text-[12px] text-fg2 underline underline-offset-2 hover:text-fg">
                필터 모두 지우기
              </button>
            )}
          </div>
        )}
      </div>

      {mode === 'table' ? (
        <div className="flex items-center">
          <label className="flex h-7 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[13px] text-fg2 hover:bg-hover">
            <Icon name="sort" size={14} />
            <select value={sort.key} onChange={(e) => setSort({ ...sort, key: e.target.value as SortKey })} className="bg-transparent outline-none" aria-label="정렬 기준">
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => setSort({ ...sort, dir: sort.dir === 'asc' ? 'desc' : 'asc' })}
            className="h-7 rounded-[6px] px-1.5 text-[13px] text-fg2 hover:bg-hover"
            title="정렬 방향 바꾸기"
          >
            {sort.dir === 'asc' ? '↑ 오름차순' : '↓ 내림차순'}
          </button>
        </div>
      ) : (
        <div className="flex shrink-0 rounded-[6px] bg-hover p-0.5" role="tablist" aria-label="그룹 기준">
          {(
            [
              ['status', isMobile ? '상태' : '상태별'],
              ['priority', isMobile ? '우선순위' : '우선순위별'],
              ['project', isMobile ? '프로젝트' : '프로젝트별'],
            ] as const
          ).map(([g, l]) => (
            <button
              key={g}
              role="tab"
              aria-selected={boardGroup === g}
              onClick={() => setBoardGroup(g)}
              className={`h-6 shrink-0 whitespace-nowrap rounded-[5px] px-2.5 text-[13px] max-md:px-2 ${boardGroup === g ? 'bg-bg font-medium text-fg shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2 hover:text-fg'}`}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-fg3">{label}</span>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  )
}
