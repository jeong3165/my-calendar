import { useId, useMemo, useState } from 'react'
import { useJournals, useItems } from '../db'
import { colorVars, tagColor } from '../lib/items'
import { Icon } from './ui'

/** 앱 전체에서 쓰인 태그 (항목 + 하루 기록), 많이 쓴 순 */
export function useAllTags(): { tag: string; count: number }[] {
  const items = useItems()
  const journals = useJournals('0000-01-01', '9999-12-31')
  return useMemo(() => {
    const m = new Map<string, number>()
    for (const it of items) if (!it.readonly) for (const t of it.tags) m.set(t, (m.get(t) ?? 0) + 1)
    for (const j of journals) for (const t of j.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1)
    return [...m.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }, [items, journals])
}

export const cleanTag = (s: string) => s.trim().replace(/^#+/, '').replace(/\s+/g, '_').slice(0, 30)

/** 태그 입력: 엔터·쉼표로 추가, 백스페이스로 마지막 빼기, 기존 태그 자동 완성 */
export function TagInput({ tags, onChange, placeholder = '태그 추가', className = '' }: { tags: string[]; onChange: (t: string[]) => void; placeholder?: string; className?: string }) {
  const [v, setV] = useState('')
  const listId = useId()
  const all = useAllTags()
  const add = () => {
    const t = cleanTag(v)
    if (t && !tags.includes(t)) onChange([...tags, t])
    setV('')
  }
  return (
    <div className={`flex flex-wrap items-center gap-1 rounded-[6px] px-2 py-[3px] focus-within:bg-hover hover:bg-hover ${className}`}>
      {tags.map((t) => (
        <span key={t} className="flex items-center gap-0.5 rounded-[3px] py-px pr-0.5 pl-1.5 text-[13px]" style={colorVars(tagColor(t))}>
          {t}
          <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="grid h-4 w-4 place-items-center rounded opacity-60 hover:opacity-100" aria-label={`${t} 태그 빼기`}>
            <Icon name="x" size={11} />
          </button>
        </span>
      ))}
      <input
        list={listId}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          } else if (e.key === 'Backspace' && !v && tags.length) onChange(tags.slice(0, -1))
        }}
        onBlur={add}
        placeholder={tags.length ? '' : placeholder}
        aria-label="태그 추가"
        className="min-w-[80px] flex-1 bg-transparent py-0.5 text-[14px] outline-none"
      />
      <datalist id={listId}>
        {all
          .filter((s) => !tags.includes(s.tag))
          .map((s) => (
            <option key={s.tag} value={s.tag} />
          ))}
      </datalist>
    </div>
  )
}
