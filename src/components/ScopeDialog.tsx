import { useState } from 'react'
import { useUI, type Scope } from '../store'
import { Icon } from './ui'

const OPTIONS: { v: Scope; label: string; hint: string }[] = [
  { v: 'this', label: '이 일정만', hint: '이 날짜 회차만 바뀌고 나머지는 그대로예요.' },
  { v: 'following', label: '이 일정과 이후 일정', hint: '이 회차부터 앞으로의 반복이 모두 바뀌어요.' },
  { v: 'all', label: '모든 일정', hint: '지난 회차를 포함해 반복 전체가 바뀌어요.' },
]

/** 반복 일정을 고치거나 지울 때 범위를 묻는 창 */
export function ScopeDialog() {
  const prompt = useUI((s) => s.scopePrompt)!
  const [v, setV] = useState<Scope>('this')
  const del = prompt.kind === 'delete'
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 px-4 pt-[18vh]"
      onMouseDown={() => prompt.resolve(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          prompt.resolve(null)
        }
        if (e.key === 'Enter') prompt.resolve(v)
      }}
    >
      <div role="dialog" aria-label="반복 일정 범위" onMouseDown={(e) => e.stopPropagation()} className="shadow-pop w-full max-w-[380px] rounded-[12px] bg-popover p-5">
        <div className="mb-3 flex items-center gap-2">
          <Icon name="repeat" size={17} className="text-fg2" />
          <h2 className="text-[16px] font-semibold">{del ? '반복 일정 삭제' : '반복 일정 변경'}</h2>
        </div>
        <div className="flex flex-col gap-1" role="radiogroup">
          {OPTIONS.map((o, i) => (
            <label key={o.v} className={`flex cursor-pointer items-start gap-2.5 rounded-[8px] px-2.5 py-2 ${v === o.v ? 'bg-active' : 'hover:bg-hover'}`}>
              <input type="radio" name="scope" checked={v === o.v} onChange={() => setV(o.v)} autoFocus={i === 0} className="mt-1 accent-[var(--accent)]" />
              <span>
                <span className="block text-[14px] font-medium">{o.label}</span>
                <span className="block text-[12px] text-fg2">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={() => prompt.resolve(null)} className="rounded-[6px] px-3 py-1.5 text-[14px] text-fg2 hover:bg-hover">
            취소
          </button>
          <button
            onClick={() => prompt.resolve(v)}
            className={`rounded-[6px] px-4 py-1.5 text-[14px] font-medium text-white hover:brightness-110 ${del ? 'bg-danger' : 'bg-accent'}`}
          >
            {del ? '삭제' : '확인'}
          </button>
        </div>
      </div>
    </div>
  )
}
