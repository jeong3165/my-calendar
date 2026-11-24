import { useMemo, useRef } from 'react'
import { exportJSON, importJSON, useItems } from '../db'
import { useUI } from '../store'
import type { Section } from '../types'
import { allTags, colorVars, sectionTasks, tagColor } from '../lib/items'
import { MiniCalendar } from './MiniCalendar'
import { TaskList, sectionTitle } from './TaskList'
import { Icon, Kbd, MOD, type IconName } from './ui'
import { SyncLabel } from './SettingsDialog'
import { syncNow, useSync } from '../lib/sync'

const NAV: { s: Section; icon: IconName }[] = [
  { s: { kind: 'today' }, icon: 'today' },
  { s: { kind: 'inbox' }, icon: 'inbox' },
  { s: { kind: 'upcoming' }, icon: 'upcoming' },
  { s: { kind: 'done' }, icon: 'done' },
]

const same = (a: Section, b: Section) => a.kind === b.kind && (a.kind !== 'tag' || (b.kind === 'tag' && a.tag === b.tag))

export function Sidebar() {
  const { section, setSection, toggleSidebar, setPalette, isMobile, sidebarOpen, setSidebar, setSettings } = useUI()
  const items = useItems()
  const tags = useMemo(() => allTags(items), [items])
  const fileRef = useRef<HTMLInputElement>(null)

  if (!sidebarOpen) return null

  const count = (s: Section) => (s.kind === 'done' ? 0 : sectionTasks(items, s).filter((t) => !t.done).length)

  const body = (
    <aside
      className={`flex h-full w-[280px] shrink-0 flex-col border-r border-line bg-sidebar ${isMobile ? 'fixed inset-y-0 left-0 z-50 shadow-pop' : ''}`}
      aria-label="사이드바"
    >
      {/* 워크스페이스 */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] px-1.5 py-1">
          <span className="grid h-[22px] w-[22px] place-items-center rounded-[4px] bg-fg text-[12px] font-semibold text-bg">나</span>
          <span className="truncate text-[14px] font-semibold">내 캘린더</span>
        </div>
        <button onClick={toggleSidebar} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg3 hover:bg-hover hover:text-fg2" aria-label="사이드바 닫기" title={`사이드바 닫기 (${MOD}+\\)`}>
          <Icon name="collapse" size={16} />
        </button>
      </div>

      <button onClick={() => setPalette(true)} className="mx-3 mb-2 flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-[14px] text-fg2 hover:bg-hover">
        <Icon name="search" size={16} />
        <span className="flex-1 text-left">검색</span>
        <Kbd>{MOD}+K</Kbd>
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <MiniCalendar />

        <nav className="px-1.5 pt-1">
          {NAV.map(({ s, icon }) => {
            const c = count(s)
            const active = same(section, s)
            return (
              <button
                key={s.kind}
                onClick={() => setSection(s)}
                className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-[14px] ${active ? 'bg-active font-medium text-fg' : 'text-fg2 hover:bg-hover'}`}
              >
                <Icon name={icon} size={16} />
                <span className="flex-1 text-left">{sectionTitle(s)}</span>
                {c > 0 && <span className="tnum text-[12px] text-fg3">{c}</span>}
              </button>
            )
          })}
        </nav>

        {tags.length > 0 && (
          <div className="px-1.5 pt-3">
            <div className="px-2 pb-1 text-[12px] font-medium text-fg3">태그</div>
            <div className="flex flex-wrap gap-1 px-2">
              {tags.map(({ tag, count: c }) => {
                const s: Section = { kind: 'tag', tag }
                const active = same(section, s)
                return (
                  <button
                    key={tag}
                    onClick={() => setSection(active ? { kind: 'today' } : s)}
                    className={`rounded-[4px] px-1.5 py-px text-[12px] ${active ? 'ring-2 ring-accent' : 'hover:brightness-95'}`}
                    style={colorVars(tagColor(tag))}
                  >
                    {tag} <span className="opacity-60">{c}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="mt-3 border-t border-line pt-3">
          <div className="px-3.5 pb-1.5 text-[12px] font-medium text-fg3">{sectionTitle(section)} 할 일</div>
          <TaskList section={section} />
        </div>
      </div>

      {/* 동기화 상태 */}
      <SyncButton onSetup={() => setSettings(true, 'sync')} />

      {/* 백업 */}
      <div className="flex gap-1 border-t border-line px-1.5 py-1.5">
        <button onClick={() => exportJSON()} className="flex flex-1 items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-[12px] text-fg2 hover:bg-hover" title="모든 데이터를 JSON 파일로 저장">
          <Icon name="download" size={14} /> 내보내기
        </button>
        <button onClick={() => fileRef.current?.click()} className="flex flex-1 items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-[12px] text-fg2 hover:bg-hover" title="백업 JSON 파일 불러오기">
          <Icon name="upload" size={14} /> 백업 열기
        </button>
        <button onClick={() => setSettings(true, 'ai')} className="grid w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" title="AI 설정" aria-label="AI 설정">
          <Icon name="settings" size={15} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (!f) return
            try {
              const n = await importJSON(f)
              alert(`${n}개 항목을 가져왔어요.`)
            } catch (err) {
              alert(`가져오기 실패: ${(err as Error).message}`)
            }
          }}
        />
      </div>
    </aside>
  )

  if (!isMobile) return body
  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setSidebar(false)} />
      {body}
    </>
  )
}

function SyncButton({ onSetup }: { onSetup: () => void }) {
  const { status, error } = useSync()
  const color =
    status === 'error' ? 'var(--danger)' : status === 'syncing' ? 'var(--accent)' : status === 'idle' ? 'var(--c-green-bar)' : 'var(--text-tertiary)'
  return (
    <div className="flex items-center gap-1 border-t border-line px-1.5 pt-1.5">
      <button
        onClick={() => (status === 'off' ? onSetup() : void syncNow())}
        title={status === 'error' ? `${error ?? ''}\n누르면 다시 시도해요.` : status === 'off' ? 'GitHub 비공개 저장소로 동기화 설정' : '누르면 지금 동기화해요'}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] text-fg2 hover:bg-hover"
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${status === 'syncing' ? 'animate-pulse' : ''}`} style={{ background: color }} />
        <span className="truncate">
          {status === 'off' ? '동기화 꺼짐 · 설정하기' : <>GitHub <SyncLabel /></>}
        </span>
      </button>
      {status !== 'off' && (
        <button onClick={onSetup} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg3 hover:bg-hover" aria-label="동기화 설정" title="동기화 설정">
          <Icon name="more" size={14} />
        </button>
      )}
    </div>
  )
}
