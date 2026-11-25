import { useEffect, useMemo, useRef, useState } from 'react'
import { format, isToday } from 'date-fns'
import { ko } from 'date-fns/locale'
import { deleteItem, updateItem } from '../db'
import { useUI } from '../store'
import type { Item } from '../types'
import { parseYmd } from '../lib/date'
import { colorVars, tagColor } from '../lib/items'
import { useProjects } from '../lib/projects'
import { checklistToTasks, newNote, NOTE_TEMPLATES, snippet, useNotes } from '../lib/notes'
import { Markdown } from './Markdown'
import { TagInput } from './TagInput'
import { Icon } from './ui'

/** 메모 페이지: 회의록·아이디어·정리 글 (마크다운) */
export function NotesView() {
  const notes = useNotes()
  const noteId = useUI((s) => s.noteId)
  const { isMobile, showToast } = useUI()
  const [q, setQ] = useState('')
  const current = notes.find((n) => n.id === noteId)
  const select = (id: string | null) => useUI.setState({ noteId: id })

  // PC: 고른 메모가 없으면 첫 메모
  useEffect(() => {
    if (!isMobile && !current && notes.length && noteId === null) select(notes[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile, notes.length])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase().replace(/^#/, '')
    return s ? notes.filter((n) => n.title.toLowerCase().includes(s) || (n.note ?? '').toLowerCase().includes(s) || n.tags.some((t) => t.toLowerCase().includes(s))) : notes
  }, [notes, q])

  async function create(template: string) {
    const n = await newNote({ template })
    select(n.id)
  }

  const newButton = <NewNoteButton onPick={(t) => void create(t)} />

  const listPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <label className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[6px] border border-line px-2 text-fg3 focus-within:border-accent">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="메모 찾기" className="min-w-0 flex-1 bg-transparent text-[13px] text-fg outline-none" />
        </label>
        {newButton}
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-3">
        {list.length === 0 && <li className="px-3 py-8 text-center text-[13px] text-fg3">{notes.length ? '찾는 메모가 없어요.' : '아직 메모가 없어요. 회의록이나 아이디어를 적어 보세요.'}</li>}
        {list.map((n) => (
          <li key={n.id}>
            <button onClick={() => select(n.id)} className={`flex w-full flex-col gap-0.5 rounded-[8px] px-2.5 py-2 text-left ${n.id === noteId ? 'bg-active' : 'hover:bg-hover'}`}>
              <span className="flex items-center gap-1 truncate text-[14px] font-medium">
                {n.pinned && <span className="text-[11px]">📌</span>}
                <span className="truncate">{n.title || '제목 없음'}</span>
              </span>
              {snippet(n.note) && <span className="truncate text-[12.5px] text-fg2">{snippet(n.note)}</span>}
              <span className="flex items-center gap-1.5 truncate text-[11.5px] text-fg3">
                {n.noteDate ? format(parseYmd(n.noteDate), 'M/d (EEE)', { locale: ko }) : isToday(new Date(n.updatedAt)) ? format(new Date(n.updatedAt), 'a h:mm', { locale: ko }) : format(new Date(n.updatedAt), 'M월 d일')}
                {n.tags.slice(0, 3).map((t) => (
                  <span key={t} className="rounded-[3px] px-1" style={colorVars(tagColor(t))}>
                    {t}
                  </span>
                ))}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )

  if (isMobile)
    return current ? (
      <NoteEditor key={current.id} note={current} onBack={() => select(null)} onToast={showToast} />
    ) : (
      listPane
    )

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r border-line">{listPane}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {current ? (
          <NoteEditor key={current.id} note={current} onToast={showToast} />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-fg2">
            <span className="text-[36px]">📝</span>
            <p className="text-[14px]">메모를 고르거나 새로 만들어 보세요.</p>
            {newButton}
          </div>
        )}
      </div>
    </div>
  )
}

/** 메모 편집: 바로 저장(0.4초 뒤), 마크다운 미리보기 */
function NoteEditor({ note, onBack, onToast }: { note: Item; onBack?: () => void; onToast: (m: string) => void }) {
  const projects = useProjects()
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.note ?? '')
  const [preview, setPreview] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Partial<Item>>({})
  const ta = useRef<HTMLTextAreaElement>(null)

  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const p = pending.current
    pending.current = {}
    if (Object.keys(p).length) void updateItem(note.id, p)
  }
  const save = (p: Partial<Item>) => {
    pending.current = { ...pending.current, ...p }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 400)
  }
  // 다른 메모로 바꾸거나 화면을 떠날 때 남은 내용 저장
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flush(), [])

  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 320)}px`
  }, [body, preview])

  const unchecked = (body.match(/^\s*[-*]\s*\[ \]\s+\S.*$/gm) ?? []).filter((l) => !l.endsWith('↗할 일')).length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[760px] flex-col gap-3 px-8 py-6 max-md:px-4 max-md:py-3">
        <div className="flex items-center gap-1">
          {onBack && (
            <button onClick={() => (flush(), onBack())} className="-ml-2 flex h-8 items-center gap-1 rounded-[6px] px-2 text-[14px] text-fg2 hover:bg-hover">
              <Icon name="left" size={16} /> 메모
            </button>
          )}
          <span className="flex-1" />
          <button onClick={() => void updateItem(note.id, { pinned: !note.pinned || undefined })} className={`h-8 rounded-[6px] px-2 text-[13px] hover:bg-hover ${note.pinned ? 'text-fg' : 'text-fg3'}`} title="목록 맨 위에 고정">
            📌 {note.pinned ? '고정됨' : '고정'}
          </button>
          <div className="flex rounded-[6px] bg-hover p-0.5 text-[13px]" role="tablist" aria-label="보기">
            {(
              [
                [false, '편집'],
                [true, '미리보기'],
              ] as const
            ).map(([v, l]) => (
              <button key={l} role="tab" aria-selected={preview === v} onClick={() => (flush(), setPreview(v))} className={`h-7 rounded-[5px] px-2.5 ${preview === v ? 'bg-bg font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2'}`}>
                {l}
              </button>
            ))}
          </div>
          <button
            onClick={async () => {
              if (!confirm('이 메모를 휴지통으로 옮길까요?')) return
              flush()
              await deleteItem(note.id)
              useUI.setState({ noteId: null })
              onToast('메모를 휴지통으로 옮겼어요.')
            }}
            className="grid h-8 w-8 place-items-center rounded-[6px] text-fg3 hover:bg-hover hover:text-danger"
            aria-label="메모 지우기"
            title="휴지통으로"
          >
            <Icon name="trash" size={15} />
          </button>
        </div>

        <input
          value={title}
          onChange={(e) => (setTitle(e.target.value), save({ title: e.target.value }))}
          placeholder="제목 없음"
          className="bg-transparent text-[30px] leading-tight font-bold outline-none placeholder:text-fg3 max-md:text-[24px]"
          aria-label="메모 제목"
        />

        <div className="flex flex-col gap-1 text-[13px]">
          <div className="flex min-h-[30px] items-center gap-2">
            <span className="w-16 shrink-0 text-fg2">날짜</span>
            <input type="date" value={note.noteDate ?? ''} onChange={(e) => void updateItem(note.id, { noteDate: e.target.value || undefined })} className="tnum rounded-[4px] bg-transparent px-1.5 py-0.5 outline-none hover:bg-hover" aria-label="메모 날짜" />
          </div>
          <div className="flex min-h-[30px] items-center gap-2">
            <span className="w-16 shrink-0 text-fg2">프로젝트</span>
            <select value={note.projectId ?? ''} onChange={(e) => void updateItem(note.id, { projectId: e.target.value || undefined })} className="min-w-0 rounded-[4px] bg-transparent px-1 py-0.5 outline-none hover:bg-hover" aria-label="프로젝트">
              <option value="">없음</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon ?? '📁'} {p.title || '이름 없음'}
                </option>
              ))}
            </select>
          </div>
          <div className="flex min-h-[30px] items-center gap-2">
            <span className="w-16 shrink-0 text-fg2">태그</span>
            <TagInput tags={note.tags} onChange={(tags) => void updateItem(note.id, { tags })} placeholder="비어 있음" className="-ml-2 min-w-0 flex-1" />
          </div>
        </div>

        {unchecked > 0 && (
          <button
            onClick={async () => {
              flush()
              const r = await checklistToTasks({ ...note, title, note: body })
              setBody(r.body)
              onToast(`체크리스트 ${r.count}개를 할 일로 만들었어요${note.noteDate ? ` (마감 ${note.noteDate.slice(5).replace('-', '/')})` : ''}.`)
            }}
            className="flex items-center gap-1.5 self-start rounded-[6px] border border-dashed border-line-strong px-2.5 py-1 text-[13px] text-fg2 hover:bg-hover hover:text-fg"
          >
            <Icon name="checklist" size={14} /> 체크리스트 {unchecked}개를 할 일로 만들기
          </button>
        )}

        <div className="border-t border-line pt-3">
          {preview ? (
            <div onDoubleClick={() => setPreview(false)} className="min-h-[200px] text-[15px] leading-[1.75]" title="두 번 누르면 편집">
              {body.trim() ? <Markdown text={body} /> : <p className="text-fg3">내용이 없어요. 편집을 눌러 적어 보세요.</p>}
            </div>
          ) : (
            <textarea
              ref={ta}
              autoFocus={!body}
              value={body}
              onChange={(e) => (setBody(e.target.value), save({ note: e.target.value }))}
              onKeyDown={(e) => {
                // 목록 줄에서 Enter → 다음 줄도 같은 목록 기호
                if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.shiftKey) return
                const el = e.currentTarget
                const start = el.selectionStart
                const line = body.slice(body.lastIndexOf('\n', start - 1) + 1, start)
                const m = line.match(/^(\s*)([-*]\s\[[ x]\]\s|[-*]\s|\d+\.\s)/)
                if (!m) return
                e.preventDefault()
                if (line.trim() === m[2].trim()) {
                  // 빈 목록 줄에서 Enter → 목록 끝내기
                  const ls = start - line.length
                  const next = body.slice(0, ls) + body.slice(start)
                  setBody(next)
                  save({ note: next })
                  requestAnimationFrame(() => el.setSelectionRange(ls, ls))
                  return
                }
                const bullet = m[2].replace('[x]', '[ ]').replace(/^\d+/, (n) => String(Number(n) + 1))
                const ins = '\n' + m[1] + bullet
                const next = body.slice(0, start) + ins + body.slice(el.selectionEnd)
                setBody(next)
                save({ note: next })
                requestAnimationFrame(() => el.setSelectionRange(start + ins.length, start + ins.length))
              }}
              placeholder={'내용을 적어 보세요.\n\n# 제목   ## 소제목\n- 목록   1. 번호 목록\n- [ ] 체크리스트 (할 일로 만들 수 있어요)\n**굵게**  | 표 | 도 돼요'}
              className="w-full resize-none bg-transparent text-[15px] leading-[1.75] outline-none placeholder:text-fg3"
              aria-label="메모 내용"
            />
          )}
        </div>
        <p className="text-[11.5px] text-fg3">
          자동 저장 · {format(new Date(note.updatedAt), 'M월 d일 a h:mm', { locale: ko })} 수정 · GitHub 동기화로 다른 기기에서도 보여요
        </p>
      </div>
    </div>
  )
}

/** 새 메모 (템플릿 고르기) — 버튼마다 메뉴를 따로 */
function NewNoteButton({ onPick }: { onPick: (template: string) => void }) {
  const [menu, setMenu] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setMenu(!menu)} className="flex h-8 items-center gap-1 rounded-[6px] bg-accent px-2.5 text-[13px] font-medium whitespace-nowrap text-white hover:brightness-110" aria-expanded={menu}>
        <Icon name="plus" size={14} /> 새 메모
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
          <div className="shadow-pop absolute right-0 z-40 mt-1 w-44 rounded-[8px] bg-popover p-1">
            {NOTE_TEMPLATES.map((t) => (
              <button key={t.key} onClick={() => (setMenu(false), onPick(t.key))} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-[14px] hover:bg-hover">
                <span>{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
