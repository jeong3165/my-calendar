import { useEffect, useState } from 'react'
import { createItem, db, deleteItem, updateItem } from '../db'
import { useUI } from '../store'
import { COLORS, type NotionColor } from '../types'
import { ymd } from '../lib/date'
import { DDAY_ICONS, ddayInfo, useDdays } from '../lib/dday'
import { lunarSupported } from '../lib/holidays'
import { Icon } from './ui'
import { TagInput } from './TagInput'

/** 사이드바: 다가오는 기념일·D-day */
export function DdaySection() {
  const list = useDdays()
  const [open, setOpen] = useState(true)
  const edit = (id: string) => useUI.setState({ ddayEdit: id })
  return (
    <div className="px-1.5 pt-3">
      <div className="flex items-center px-2 pb-1">
        <button onClick={() => setOpen(!open)} className="flex flex-1 items-center gap-1 text-left text-[12px] font-medium text-fg3 hover:text-fg2">
          기념일·D-day {list.length > 0 && <span>{open ? '▾' : `▸ ${list.length}`}</span>}
        </button>
        <button onClick={() => edit('new')} className="grid h-5 w-5 place-items-center rounded text-fg3 hover:bg-hover hover:text-fg2" title="기념일 추가" aria-label="기념일 추가">
          <Icon name="plus" size={13} />
        </button>
      </div>
      {list.length === 0 ? (
        <button onClick={() => edit('new')} className="w-full rounded-[6px] px-2 py-1 text-left text-[12px] text-fg3 hover:bg-hover">
          생일·기념일·시험일 남은 날 세기 →
        </button>
      ) : (
        open &&
        list.slice(0, 8).map((d) => (
          <button key={d.item.id} onClick={() => edit(d.item.id)} className="flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left hover:bg-hover" title={d.sub}>
            <span className="w-5 shrink-0 text-center text-[15px]">{d.item.icon ?? '🎉'}</span>
            <span className="min-w-0 flex-1 truncate text-[14px] text-fg2">{d.item.title || '기념일'}</span>
            <span
              className={`tnum shrink-0 rounded-[4px] px-1.5 text-[12px] font-semibold ${d.diff === 0 ? 'bg-danger text-white' : d.diff > 0 && d.diff <= 7 ? 'text-danger' : d.diff < 0 ? 'text-fg3' : 'text-fg2'}`}
            >
              {d.label}
            </span>
          </button>
        ))
      )}
    </div>
  )
}

/** 기념일 추가·편집 창 */
export function DdayDialog() {
  const id = useUI((s) => s.ddayEdit)!
  const { showToast } = useUI()
  const close = () => useUI.setState({ ddayEdit: null })
  const isNew = id === 'new'
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(ymd(new Date()))
  const [yearly, setYearly] = useState(true)
  const [lunar, setLunar] = useState(false)
  const [noYear, setNoYear] = useState(false)
  const [icon, setIcon] = useState<string>('🎂')
  const [color, setColor] = useState<NotionColor>('pink')
  const [tags, setTags] = useState<string[]>([])
  const [loaded, setLoaded] = useState(isNew)

  useEffect(() => {
    if (isNew) return
    void db.items.get(id).then((it) => {
      if (!it?.anniv) return close()
      setTitle(it.title)
      setDate(it.anniv.date)
      setYearly(it.anniv.yearly)
      setLunar(!!it.anniv.lunar)
      setNoYear(!!it.anniv.noYear)
      setIcon(it.icon ?? '🎉')
      setColor(it.color)
      setTags(it.tags)
      setLoaded(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const anniv = { date, yearly, ...(yearly && lunar ? { lunar: true } : {}), ...(yearly && noYear ? { noYear: true } : {}) }
  const preview = date ? ddayInfo({ id: 'x', type: 'dday', title, tags: [], color, anniv, icon, createdAt: '', updatedAt: '' }) : null

  async function save() {
    if (!title.trim() || !date) return
    if (isNew) await createItem({ type: 'dday', title: title.trim(), anniv, icon, color, tags })
    else await updateItem(id, { title: title.trim(), anniv, icon, color, tags })
    showToast(isNew ? '기념일을 추가했어요.' : '기념일을 고쳤어요.')
    close()
  }

  if (!loaded) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 md:items-start md:px-4 md:pt-[10vh]" onMouseDown={close}>
      <form
        role="dialog"
        aria-label="기념일"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className="shadow-pop flex w-full flex-col gap-4 rounded-t-[16px] bg-popover p-5 pb-[max(20px,env(safe-area-inset-bottom))] md:max-w-[440px] md:rounded-[12px]"
      >
        <div className="flex items-center">
          <h2 className="flex-1 text-[16px] font-semibold">{isNew ? '기념일·D-day 추가' : '기념일 고치기'}</h2>
          <button type="button" onClick={close} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex flex-wrap gap-1">
          {DDAY_ICONS.map((ic) => (
            <button key={ic} type="button" onClick={() => setIcon(ic)} className={`grid h-9 w-9 place-items-center rounded-[8px] text-[18px] ${icon === ic ? 'bg-active ring-2 ring-accent' : 'hover:bg-hover'}`} aria-label={`아이콘 ${ic}`}>
              {ic}
            </button>
          ))}
        </div>

        <input autoFocus={isNew} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="이름 (예: 엄마 생신, 결혼기념일, 자격증 시험)" className="rounded-[8px] border border-line-strong bg-bg px-3 py-2 text-[15px] outline-none focus:border-accent" />

        <div className="flex rounded-[8px] bg-hover p-0.5 text-[13px]" role="tablist">
          {(
            [
              [true, '매년 돌아오는 날', '생일·기념일'],
              [false, '한 번뿐인 날', '시험·여행·만난 날'],
            ] as const
          ).map(([v, l, h]) => (
            <button key={l} type="button" role="tab" aria-selected={yearly === v} onClick={() => setYearly(v)} className={`flex flex-1 flex-col items-center rounded-[6px] py-1.5 ${yearly === v ? 'bg-bg font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2'}`}>
              {l}
              <span className="text-[11px] font-normal text-fg3">{h}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-[13px]">
            <span className="w-14 shrink-0 text-fg2">{yearly && lunar ? '음력 날짜' : '날짜'}</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 rounded-[8px] border border-line-strong bg-bg px-2 py-1.5 outline-none focus:border-accent" />
          </label>
          {yearly && (
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 pl-16 text-[13px]">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={lunar} onChange={(e) => setLunar(e.target.checked)} disabled={!lunarSupported()} className="accent-[var(--accent)]" />
                음력
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={noYear} onChange={(e) => setNoYear(e.target.checked)} className="accent-[var(--accent)]" />
                연도 모름 (몇 번째인지 안 셈)
              </label>
            </div>
          )}
          {yearly && lunar && <p className="pl-16 text-[12px] text-fg3">음력 월·일을 그대로 넣으세요. 해마다 양력 날짜로 바꿔서 보여 줘요.</p>}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="w-14 shrink-0 text-[13px] text-fg2">태그</span>
          <TagInput tags={tags} onChange={setTags} placeholder="예: 가족, 시험" className="-ml-2 min-w-0 flex-1" />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-14 shrink-0 text-[13px] text-fg2">색</span>
          {COLORS.map((c) => (
            <button key={c} type="button" onClick={() => setColor(c)} className={`h-5 w-5 rounded-full ${color === c ? 'ring-2 ring-fg ring-offset-2 ring-offset-popover' : ''}`} style={{ background: `var(--c-${c}-bar)` }} aria-label={c} />
          ))}
        </div>

        {preview && (
          <div className="flex items-center gap-3 rounded-[10px] bg-hover px-3 py-2.5">
            <span className="text-[22px]">{icon}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-medium">{title || '이름 없음'}</div>
              <div className="text-[12px] text-fg2">{preview.sub}</div>
            </div>
            <span className={`tnum text-[20px] font-bold ${preview.diff === 0 || (preview.diff > 0 && preview.diff <= 7) ? 'text-danger' : ''}`}>{preview.label}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          {!isNew && (
            <button
              type="button"
              onClick={async () => {
                if (!confirm('이 기념일을 지울까요?')) return
                await deleteItem(id)
                showToast('기념일을 휴지통으로 옮겼어요.')
                close()
              }}
              className="rounded-[6px] px-2.5 py-1.5 text-[13px] text-fg2 hover:bg-hover hover:text-danger"
            >
              지우기
            </button>
          )}
          <span className="flex-1" />
          <button type="button" onClick={close} className="rounded-[6px] px-3 py-1.5 text-[13px] text-fg2 hover:bg-hover">
            취소
          </button>
          <button disabled={!title.trim() || !date} className="rounded-[6px] bg-accent px-4 py-1.5 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40">
            저장
          </button>
        </div>
      </form>
    </div>
  )
}
