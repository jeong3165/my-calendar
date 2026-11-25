import { useMemo, useRef, useState } from 'react'
import { importJSON, useItems } from '../db'
import { DdaySection } from './Dday'
import { LAYOUT_DEFAULT, useUI } from '../store'
import { Resizer } from './Resizer'
import type { Section } from '../types'
import { allTags, colorVars, sectionTasks, tagColor } from '../lib/items'
import { MiniCalendar } from './MiniCalendar'
import { TaskList, sectionTitle } from './TaskList'
import { Icon, Kbd, MOD, type IconName } from './ui'
import { SyncLabel } from './SettingsDialog'
import { syncNow, useSync } from '../lib/sync'
import { setSubscriptions, useSubs } from '../lib/subs'
import { createProject, projectStats, useProjects } from '../lib/projects'
import { useTemplates } from '../lib/templates'
import type { TemplatesView } from './TemplatesDialog'

const NAV: { s: Section; icon: IconName }[] = [
  { s: { kind: 'today' }, icon: 'today' },
  { s: { kind: 'inbox' }, icon: 'inbox' },
  { s: { kind: 'upcoming' }, icon: 'upcoming' },
  { s: { kind: 'done' }, icon: 'done' },
]

const same = (a: Section, b: Section) => a.kind === b.kind && (a.kind !== 'tag' || (b.kind === 'tag' && a.tag === b.tag))

export function Sidebar() {
  const { section, setSection, toggleSidebar, setPalette, isMobile, sidebarOpen, setSidebar, setSettings, sidebarW, setLayout, screen } = useUI()
  const overlay = screen !== 'desktop' // 좁은 화면에서는 캘린더 위에 겹쳐서
  const items = useItems()
  const tags = useMemo(() => allTags(items), [items])
  const fileRef = useRef<HTMLInputElement>(null)

  if (!sidebarOpen) return null

  const count = (s: Section) => (s.kind === 'done' ? 0 : sectionTasks(items, s).filter((t) => !t.done).length)

  const body = (
    <aside
      className={`flex h-full shrink-0 flex-col border-r border-line bg-sidebar ${overlay ? 'fixed inset-y-0 left-0 z-50 shadow-pop' : 'relative'}`}
      style={{ width: isMobile ? 'min(85vw, 320px)' : sidebarW }}
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

        <ProjectsSection />

        <DdaySection />

        <TemplatesSection />

        <SubsSection onSetup={() => setSettings(true, 'subs')} />

        <div className="mt-3 border-t border-line pt-3">
          <div className="px-3.5 pb-1.5 text-[12px] font-medium text-fg3">{sectionTitle(section)} 할 일</div>
          <TaskList section={section} />
        </div>
      </div>

      {/* 동기화 상태 */}
      <SyncButton onSetup={() => setSettings(true, 'sync')} />

      {/* 백업 */}
      <div className="flex gap-1 border-t border-line px-1.5 py-1.5">
        <button onClick={() => useUI.setState({ exportOpen: true })} className="flex flex-1 items-center justify-center gap-1.5 rounded-[6px] py-1.5 text-[12px] text-fg2 hover:bg-hover" title="엑셀(CSV)로 내보내기 또는 전체 백업(JSON)">
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
      {!isMobile && <Resizer edge="right" value={sidebarW} min={220} max={440} onChange={(w) => setLayout({ sidebarW: w })} onReset={() => setLayout({ sidebarW: LAYOUT_DEFAULT.sidebarW })} label="사이드바 너비" />}
    </aside>
  )

  if (!overlay) return body
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
    <div className="border-t border-line px-1.5 pt-1.5">
    <div className="flex items-center gap-1">
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
    {status === 'error' && error && (
      <button onClick={onSetup} className="mx-2 mb-1 block max-h-32 overflow-y-auto rounded-[6px] px-2 py-1.5 text-left text-[12px] leading-snug text-danger" style={{ background: 'var(--c-red-bg)' }}>
        {error}
      </button>
    )}
    </div>
  )
}

/** 사이드바: 구독 캘린더 목록 (눌러서 보이기/숨기기) */
function SubsSection({ onSetup }: { onSetup: () => void }) {
  const { list, status } = useSubs()
  return (
    <div className="px-1.5 pt-3">
      <div className="flex items-center px-2 pb-1">
        <span className="flex-1 text-[12px] font-medium text-fg3">구독 캘린더</span>
        <button onClick={onSetup} className="grid h-5 w-5 place-items-center rounded text-fg3 hover:bg-hover hover:text-fg2" title="구독 추가·관리" aria-label="구독 추가·관리">
          <Icon name="plus" size={13} />
        </button>
      </div>
      {list.length === 0 ? (
        <button onClick={onSetup} className="w-full rounded-[6px] px-2 py-1 text-left text-[12px] text-fg3 hover:bg-hover">
          회사·구글 캘린더 함께 보기 →
        </button>
      ) : (
        list.map((s) => {
          const st = status[s.id]
          return (
            <button
              key={s.id}
              onClick={() => setSubscriptions(list.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)))}
              className="flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left text-[13px] hover:bg-hover"
              title={st?.state === 'error' ? st.error : s.enabled ? '눌러서 숨기기' : '눌러서 보이기'}
            >
              <span
                className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px]"
                style={{ borderColor: `var(--c-${s.color}-bar)`, background: s.enabled ? `var(--c-${s.color}-bar)` : 'transparent' }}
              >
                {s.enabled && (
                  <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth={2.2} strokeLinecap="round">
                    <path d="m2.5 6.2 2.3 2.3 4.7-5" />
                  </svg>
                )}
              </span>
              <span className={`min-w-0 flex-1 truncate ${s.enabled ? '' : 'text-fg3'}`}>{s.name}</span>
              {st?.state === 'error' && <Icon name="alert" size={12} className="shrink-0 text-danger" />}
              {st?.state === 'loading' && <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" />}
            </button>
          )
        })
      )}
    </div>
  )
}

/** 사이드바: 프로젝트 목록 (진행률 표시) */
function ProjectsSection() {
  const projects = useProjects()
  const items = useItems()
  const { mode, projectId, openProject } = useUI()
  const [showDone, setShowDone] = useState(false)
  const active = projects.filter((p) => !p.done)
  const done = projects.filter((p) => p.done)
  const row = (p: (typeof projects)[number]) => {
    const st = projectStats(p, items)
    const on = mode === 'project' && projectId === p.id
    return (
      <button
        key={p.id}
        onClick={() => openProject(p.id)}
        className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left text-[14px] ${on ? 'bg-active font-medium text-fg' : 'text-fg2 hover:bg-hover'}`}
      >
        <span className="w-5 shrink-0 text-center text-[15px]">{p.icon ?? '📁'}</span>
        <span className={`min-w-0 flex-1 truncate ${p.done ? 'line-through' : ''}`}>{p.title || '이름 없는 프로젝트'}</span>
        {st.total > 0 && <span className="tnum shrink-0 text-[11px] text-fg3">{Math.round(st.pct * 100)}%</span>}
      </button>
    )
  }
  return (
    <div className="px-1.5 pt-3">
      <div className="flex items-center px-2 pb-1">
        <span className="flex-1 text-[12px] font-medium text-fg3">프로젝트</span>
        <button
          onClick={async () => openProject((await createProject()).id)}
          className="grid h-5 w-5 place-items-center rounded text-fg3 hover:bg-hover hover:text-fg2"
          title="새 프로젝트"
          aria-label="새 프로젝트"
        >
          <Icon name="plus" size={13} />
        </button>
      </div>
      {projects.length === 0 && (
        <button onClick={async () => openProject((await createProject()).id)} className="w-full rounded-[6px] px-2 py-1 text-left text-[12px] text-fg3 hover:bg-hover">
          할 일을 프로젝트로 묶어 보세요 →
        </button>
      )}
      {active.map(row)}
      {done.length > 0 && (
        <>
          <button onClick={() => setShowDone(!showDone)} className="px-2 py-1 text-[12px] text-fg3 hover:text-fg2">
            {showDone ? '▾' : '▸'} 완료된 프로젝트 {done.length}
          </button>
          {showDone && done.map(row)}
        </>
      )}
    </div>
  )
}

/** 사이드바: 템플릿 (누르면 바로 넣기 화면) */
function TemplatesSection() {
  const templates = useTemplates()
  const [open, setOpen] = useState(false)
  const show = (v: TemplatesView) => useUI.setState({ templates: v })
  return (
    <div className="px-1.5 pt-3">
      <div className="flex items-center px-2 pb-1">
        <button onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1 text-left text-[12px] font-medium text-fg3 hover:text-fg2">
          템플릿 {templates.length > 0 && <span>{open ? '▾' : `▸ ${templates.length}`}</span>}
        </button>
        <button onClick={() => show({ view: 'list' })} className="grid h-5 w-5 place-items-center rounded text-fg3 hover:bg-hover hover:text-fg2" title="템플릿 관리" aria-label="템플릿 관리">
          <Icon name="plus" size={13} />
        </button>
      </div>
      {templates.length === 0 ? (
        <button onClick={() => show({ view: 'list' })} className="w-full rounded-[6px] px-2 py-1 text-left text-[12px] text-fg3 hover:bg-hover">
          자주 쓰는 할 일 묶음 저장하기 →
        </button>
      ) : (
        open &&
        templates.map((t) => (
          <button key={t.id} onClick={() => show({ view: 'apply', id: t.id })} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left text-[14px] text-fg2 hover:bg-hover">
            <span className="w-5 shrink-0 text-center text-[15px]">{t.icon ?? '📋'}</span>
            <span className="min-w-0 flex-1 truncate">{t.title}</span>
          </button>
        ))
      )}
    </div>
  )
}
