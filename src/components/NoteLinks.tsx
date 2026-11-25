import { useUI } from '../store'
import type { Item } from '../types'
import { newNote, snippet, useNotes } from '../lib/notes'
import { Icon } from './ui'

/** 관련 메모 목록 + 새 메모 (프로젝트·하루 정리·태그 보기에서) */
export function NoteLinks({ filter, create, title = '메모', newLabel = '새 메모' }: { filter: (n: Item) => boolean; create?: { template?: string; projectId?: string; date?: string; tags?: string[] }; title?: string; newLabel?: string }) {
  const notes = useNotes().filter(filter)
  const go = (id: string) => {
    useUI.setState({ noteId: id })
    useUI.getState().setMode('notes')
  }
  if (!notes.length && !create) return null
  return (
    <section>
      <div className="mb-1 flex items-center px-1">
        <h3 className="flex-1 text-[14px] font-semibold">
          {title} {notes.length > 0 && <span className="text-[12px] font-normal text-fg3">{notes.length}</span>}
        </h3>
        {create && (
          <button onClick={async () => go((await newNote(create)).id)} className="flex items-center gap-1 rounded-[6px] px-2 py-0.5 text-[13px] text-fg2 hover:bg-hover">
            <Icon name="plus" size={13} /> {newLabel}
          </button>
        )}
      </div>
      {notes.length === 0 ? (
        <p className="px-1 text-[13px] text-fg3">아직 메모가 없어요.</p>
      ) : (
        <ul className="flex flex-col">
          {notes.map((n) => (
            <li key={n.id}>
              <button onClick={() => go(n.id)} className="flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1.5 text-left hover:bg-hover">
                <span className="text-[14px]">{n.pinned ? '📌' : '📝'}</span>
                <span className="shrink-0 text-[14px]">{n.title || '제목 없음'}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg3">{snippet(n.note)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
