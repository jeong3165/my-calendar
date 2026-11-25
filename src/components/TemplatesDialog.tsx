import { useMemo, useState } from 'react'
import { addDays } from 'date-fns'
import { deleteItem, updateItem } from '../db'
import { useUI } from '../store'
import { TagInput } from './TagInput'
import type { Item, TemplateData } from '../types'
import { parseYmd, relDay, ymd } from '../lib/date'
import { applyTemplate, expandTask, parseTemplate, saveTemplate, STARTERS, useTemplates } from '../lib/templates'
import { PROJECT_ICONS } from '../lib/projects'
import { Checkbox, Icon } from './ui'

export type TemplatesView = { view: 'list' } | { view: 'edit'; id?: string; seed?: { name: string; icon: string; data: TemplateData } } | { view: 'apply'; id: string }

export function TemplatesDialog() {
  const state = useUI((s) => s.templates)!
  const close = () => useUI.setState({ templates: null })
  const go = (v: TemplatesView) => useUI.setState({ templates: v })
  const templates = useTemplates()
  const tpl = state.view !== 'list' && 'id' in state && state.id ? templates.find((t) => t.id === state.id) : undefined

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/30 md:items-start md:px-4 md:pt-[6vh]" onMouseDown={close}>
      <div role="dialog" aria-label="템플릿" onMouseDown={(e) => e.stopPropagation()} className="shadow-pop flex w-full flex-col overflow-hidden bg-popover md:max-h-[88vh] md:max-w-[680px] md:rounded-[12px]">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          {state.view !== 'list' && (
            <button onClick={() => go({ view: 'list' })} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="목록으로">
              <Icon name="left" size={16} />
            </button>
          )}
          <Icon name="checklist" size={17} className="text-fg2" />
          <h2 className="flex-1 text-[16px] font-semibold">{state.view === 'list' ? '템플릿' : state.view === 'apply' ? '템플릿 넣기' : state.id ? '템플릿 고치기' : '새 템플릿'}</h2>
          <button onClick={close} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>
        {state.view === 'list' && <ListView templates={templates} go={go} />}
        {state.view === 'apply' && tpl && <ApplyView tpl={tpl} onDone={close} onEdit={() => go({ view: 'edit', id: tpl.id })} />}
        {state.view === 'edit' && <EditView key={state.id ?? 'new'} tpl={tpl} seed={state.seed} onSaved={(id) => go({ view: 'apply', id })} onDeleted={() => go({ view: 'list' })} />}
      </div>
    </div>
  )
}

function ListView({ templates, go }: { templates: Item[]; go: (v: TemplatesView) => void }) {
  const unused = STARTERS.filter((s) => !templates.some((t) => t.title === s.name))
  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-5">
      <p className="text-[13px] leading-relaxed text-fg2">자주 반복하는 할 일 묶음을 저장해 두고, 원하는 날짜에 한 번에 넣어요. 프로젝트 템플릿은 프로젝트째 만들어져요.</p>
      {templates.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {templates.map((t) => {
            const n = parseTemplate(t.template!.text).length
            return (
              <li key={t.id}>
                <button onClick={() => go({ view: 'apply', id: t.id })} className="flex w-full items-center gap-3 rounded-[10px] border border-line p-3 text-left hover:bg-hover">
                  <span className="text-[24px]">{t.icon ?? '📋'}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{t.title}</span>
                    <span className="text-[12px] text-fg2">
                      {t.template!.kind === 'project' ? '프로젝트 · ' : ''}할 일 {n}개
                    </span>
                  </span>
                  <span className="text-[12px] text-accent">넣기 →</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <button onClick={() => go({ view: 'edit' })} className="flex items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-line-strong py-2.5 text-[14px] text-fg2 hover:bg-hover hover:text-fg">
        <Icon name="plus" size={15} /> 새 템플릿 만들기
      </button>
      {unused.length > 0 && (
        <div>
          <p className="mb-2 text-[12px] font-medium text-fg3">예시에서 시작하기</p>
          <div className="flex flex-wrap gap-2">
            {unused.map((s) => (
              <button key={s.name} onClick={() => go({ view: 'edit', seed: s })} className="flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] hover:bg-hover">
                {s.icon} {s.name}
                <span className="text-[11px] text-fg3">{s.data.kind === 'project' ? '프로젝트' : '할 일'}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className="text-[12px] text-fg3">지금 진행 중인 프로젝트도 프로젝트 화면 아래 "템플릿으로 저장"으로 만들 수 있어요.</p>
    </div>
  )
}

function ApplyView({ tpl, onDone, onEdit }: { tpl: Item; onDone: () => void; onEdit: () => void }) {
  const { setMode, setView, setDate, openProject, showToast } = useUI()
  const data = tpl.template!
  const isProject = data.kind === 'project'
  const tasks = useMemo(() => parseTemplate(data.text), [data.text])
  const minOffset = Math.min(0, ...tasks.map((t) => t.offset))
  // 프로젝트는 기준일 = 마감일 → 기본값은 가장 이른 할 일이 오늘이 되도록
  const [anchor, setAnchor] = useState(() => ymd(addDays(new Date(), isProject ? -minOffset : 0)))
  const [title, setTitle] = useState(tpl.title)
  const [include, setInclude] = useState<boolean[]>(() => tasks.map(() => true))
  const preview = tasks.map((t) => expandTask(t, anchor))
  const count = include.filter(Boolean).length

  async function go() {
    const r = await applyTemplate(tpl, anchor, { projectTitle: title, include })
    showToast(`"${tpl.title}"에서 할 일 ${count}개를 넣었어요.`)
    onDone()
    if (r.projectId) openProject(r.projectId)
    else {
      const first = preview.filter((_, i) => include[i]).map((p) => p.due!).sort()[0]
      setMode('calendar')
      setView('week')
      if (first) setDate(parseYmd(first))
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-5">
        <div className="flex items-center gap-3">
          <span className="text-[28px]">{tpl.icon ?? '📋'}</span>
          {isProject ? (
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="min-w-0 flex-1 rounded-[8px] border border-line-strong bg-bg px-3 py-1.5 text-[16px] font-semibold outline-none focus:border-accent" aria-label="새 프로젝트 이름" />
          ) : (
            <span className="flex-1 text-[16px] font-semibold">{tpl.title}</span>
          )}
          <button onClick={onEdit} className="rounded-[6px] px-2 py-1 text-[13px] text-fg2 hover:bg-hover">
            고치기
          </button>
        </div>
        <label className="flex flex-wrap items-center gap-2 text-[14px]">
          <span className="text-fg2">{isProject ? '마감일 (기준일)' : '넣을 날짜'}</span>
          <input type="date" value={anchor} onChange={(e) => e.target.value && setAnchor(e.target.value)} className="tnum rounded-[6px] border border-line-strong bg-bg px-2 py-1 outline-none focus:border-accent" />
          <span className="text-[12px] text-fg3">{isProject ? 'D-30 같은 날짜가 이 날을 기준으로 계산돼요' : '+1 은 다음 날, D-1 은 전날이에요'}</span>
        </label>
        <ul className="flex flex-col">
          {tasks.map((t, i) => {
            const p = preview[i]
            return (
              <li key={i} className={`flex items-start gap-2.5 rounded-[6px] px-2 py-1.5 hover:bg-hover ${include[i] ? '' : 'opacity-40'}`}>
                <span className="pt-[3px]">
                  <Checkbox checked={include[i]} onChange={(v) => setInclude(include.map((x, j) => (j === i ? v : x)))} size={15} label="넣기" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px]">
                    {t.title}
                    {t.priority === 'high' && <Icon name="flag" size={11} className="ml-1 inline text-danger" />}
                  </span>
                  {t.subtasks.length > 0 && <span className="block text-[12px] text-fg3">☑ {t.subtasks.join(' · ')}</span>}
                </span>
                <span className="tnum shrink-0 text-[12px] text-fg2">
                  {relDay(p.due!)}
                  {t.start ? ` ${t.start}${t.end ? `–${t.end}` : ''}` : ''}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <span className="flex-1 text-[12px] text-fg3">{isProject ? '새 프로젝트를 만들고 그 안에 넣어요' : '시간이 있는 줄은 시간 블록으로 들어가요'}</span>
        <button onClick={go} disabled={!count} className="h-9 rounded-[6px] bg-accent px-4 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40">
          {count}개 넣기
        </button>
      </div>
    </>
  )
}

function EditView({ tpl, seed, onSaved, onDeleted }: { tpl?: Item; seed?: { name: string; icon: string; data: TemplateData }; onSaved: (id: string) => void; onDeleted: () => void }) {
  const init = tpl ? { name: tpl.title, icon: tpl.icon ?? '📋', data: tpl.template! } : (seed ?? { name: '', icon: '📋', data: { kind: 'list' as const, text: '' } })
  const [name, setName] = useState(init.name)
  const [icon, setIcon] = useState(init.icon)
  const [tags, setTags] = useState<string[]>(tpl?.tags ?? [])
  const [kind, setKind] = useState(init.data.kind)
  const [text, setText] = useState(init.data.text)
  const parsed = parseTemplate(text)

  async function save() {
    const data: TemplateData = { ...init.data, kind, text }
    if (tpl) {
      await updateItem(tpl.id, { title: name.trim(), icon, template: data, tags })
      onSaved(tpl.id)
    } else {
      const created = await saveTemplate(name.trim(), data, icon)
      if (tags.length) await updateItem(created.id, { tags })
      onSaved(created.id)
    }
  }

  return (
    <>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5">
        <div className="flex items-center gap-2">
          <select value={icon} onChange={(e) => setIcon(e.target.value)} className="rounded-[8px] border border-line-strong bg-bg px-1.5 py-1.5 text-[18px] outline-none" aria-label="아이콘">
            {[...new Set([icon, '📋', '☀️', '🗂️', ...PROJECT_ICONS])].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus={!name} placeholder="템플릿 이름 (예: 출근 루틴)" className="min-w-0 flex-1 rounded-[8px] border border-line-strong bg-bg px-3 py-1.5 text-[15px] font-semibold outline-none focus:border-accent" />
        </div>
        <div className="flex items-center gap-2 text-[13px]">
          <span className="shrink-0 text-fg2">태그</span>
          <TagInput tags={tags} onChange={setTags} placeholder="적용할 때 모든 할 일에 붙여요 (예: 출장)" className="min-w-0 flex-1" />
        </div>
        <div className="flex gap-1 rounded-[6px] bg-hover p-0.5 text-[13px]">
          {(
            [
              ['list', '할 일 묶음'],
              ['project', '프로젝트째 만들기'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setKind(k)} className={`flex-1 rounded-[5px] py-1 ${kind === k ? 'bg-bg font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2'}`}>
              {l}
            </button>
          ))}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={kind === 'project' ? 'D-30 견적 받기 !높음\nD-7 서류 준비\n  - 신분증\n+1 정리하기' : '07:00-07:20 스트레칭 #건강\n09:00 메일 확인\n+1 주간 보고서 쓰기 !높음'}
          className="resize-y rounded-[10px] border border-line-strong bg-bg px-3 py-2.5 font-mono text-[13px] leading-[22px] outline-none focus:border-accent"
        />
        <details className="text-[12px] text-fg2">
          <summary className="cursor-pointer">쓰는 법</summary>
          <ul className="mt-1.5 flex list-disc flex-col gap-0.5 pl-5 leading-relaxed">
            <li>한 줄에 할 일 하나. 빠른 입력 문법 그대로: 시간 <code>09:00-10:00</code>, 태그 <code>#회사</code>, 우선순위 <code>!높음</code></li>
            <li>
              날짜: 앞에 <code>+1</code>(다음 날), <code>D-7</code>(기준일 7일 전), <code>2일차</code>. 안 적으면 기준일
            </li>
            <li>
              하위 할 일: 다음 줄을 들여쓰고 <code>- </code>로 시작
            </li>
            <li>
              <code>//</code> 로 시작하는 줄은 메모로 무시
            </li>
          </ul>
        </details>
        <p className="text-[12px] text-fg3">할 일 {parsed.length}개로 읽혀요.</p>
      </div>
      <div className="flex items-center gap-2 border-t border-line px-5 py-3">
        {tpl && (
          <button
            onClick={async () => {
              if (!confirm(`"${tpl.title}" 템플릿을 지울까요? (이미 넣은 할 일은 그대로예요)`)) return
              await deleteItem(tpl.id)
              onDeleted()
            }}
            className="rounded-[6px] px-2 py-1 text-[13px] text-fg3 hover:bg-hover hover:text-danger"
          >
            삭제
          </button>
        )}
        <span className="flex-1" />
        <button onClick={save} disabled={!name.trim() || !parsed.length} className="h-9 rounded-[6px] bg-accent px-4 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40">
          저장
        </button>
      </div>
    </>
  )
}
