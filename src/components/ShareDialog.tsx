import { useEffect, useState } from 'react'
import { addWeeks, format, startOfWeek } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useUI } from '../store'
import { WEEK } from '../lib/date'
import { useCalendarItems } from '../lib/subs'
import { loadShare, renderWeekImage, saveShare, weekFileName, type ShareOptions } from '../lib/shareImage'
import { Icon } from './ui'

/** 주간 일정을 이미지로: 미리보기 → 공유(휴대폰)·저장·복사 */
export function ShareDialog() {
  const { showToast } = useUI()
  const close = () => useUI.setState({ shareOpen: false })
  const all = useCalendarItems()
  const [week, setWeek] = useState(() => startOfWeek(useUI.getState().date, WEEK))
  const [o, setO] = useState<ShareOptions>(loadShare)
  const [img, setImg] = useState<{ blob: Blob; url: string } | null>(null)
  const set = (p: Partial<ShareOptions>) => {
    const n = { ...o, ...p }
    setO(n)
    saveShare(n)
  }

  useEffect(() => {
    let live = true
    const t = setTimeout(async () => {
      const blob = await renderWeekImage(all, week, o)
      if (!live) return
      setImg({ blob, url: URL.createObjectURL(blob) })
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [all, week, o])
  useEffect(
    () => () => {
      if (img) URL.revokeObjectURL(img.url) // 새 이미지로 바뀌거나 닫을 때 이전 것 정리
    },
    [img],
  )

  const file = () => img && new File([img.blob], weekFileName(week), { type: 'image/png' })
  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare && (() => {
    try {
      return navigator.canShare({ files: [new File([new Blob()], 'x.png', { type: 'image/png' })] })
    } catch {
      return false
    }
  })()
  const canCopy = typeof window !== 'undefined' && 'ClipboardItem' in window

  const check = (k: keyof ShareOptions, label: string) => (
    <label className="flex items-center gap-1.5 whitespace-nowrap">
      <input type="checkbox" checked={!!o[k]} onChange={(e) => set({ [k]: e.target.checked })} className="accent-[var(--accent)]" />
      {label}
    </label>
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/30 md:items-start md:px-4 md:pt-[4vh]" onMouseDown={close}>
      <div role="dialog" aria-label="주간 일정 공유" onMouseDown={(e) => e.stopPropagation()} className="shadow-pop flex w-full flex-col bg-popover pt-[env(safe-area-inset-top)] md:max-h-[92vh] md:max-w-[880px] md:rounded-[12px] md:pt-0">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3 max-md:px-3">
          <Icon name="share" size={17} className="text-fg2" />
          <h2 className="flex-1 text-[16px] font-semibold">주간 일정 이미지</h2>
          <button onClick={() => setWeek(addWeeks(week, -1))} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="지난주">
            <Icon name="left" size={16} />
          </button>
          <span className="tnum text-[14px] font-medium whitespace-nowrap">{format(week, 'M월 d일', { locale: ko })} 주</span>
          <button onClick={() => setWeek(addWeeks(week, 1))} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="다음 주">
            <Icon name="right" size={16} />
          </button>
          <button onClick={close} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 max-md:flex-col">
          <div className="flex shrink-0 flex-col gap-3 border-line p-4 text-[13px] md:w-[290px] md:border-r max-md:border-b max-md:p-3">
            <label className="flex flex-col gap-1">
              <span className="text-fg2">제목</span>
              <input value={o.title} onChange={(e) => set({ title: e.target.value })} placeholder="비우면 '11월 4주차 일정'" className="rounded-[8px] border border-line-strong bg-bg px-2 py-1.5 outline-none focus:border-accent" />
            </label>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {check('weekend', '주말')}
              {check('tasks', '할 일')}
              {check('emptyDays', '빈 날')}
              {check('subs', '구독 캘린더')}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-fg2">
                <input value={o.privateTag} onChange={(e) => set({ privateTag: e.target.value.replace(/^#/, '').trim() })} className="mr-1 w-16 rounded-[6px] border border-line-strong bg-bg px-1.5 py-0.5 outline-none focus:border-accent" aria-label="비공개 태그" />
                태그가 붙은 일정은
              </span>
              <div className="flex rounded-[6px] bg-hover p-0.5" role="radiogroup" aria-label="비공개 일정">
                {(
                  [
                    ['mask', '"개인 일정"으로'],
                    ['hide', '빼기'],
                    ['show', '그대로'],
                  ] as const
                ).map(([k, l]) => (
                  <button key={k} role="radio" aria-checked={o.privateMode === k} onClick={() => set({ privateMode: k })} className={`h-7 flex-1 rounded-[5px] whitespace-nowrap ${o.privateMode === k ? 'bg-bg font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-auto flex flex-col gap-2 max-md:flex-row">
              {canShare && (
                <button
                  disabled={!img}
                  onClick={async () => {
                    try {
                      await navigator.share({ files: [file()!], title: '주간 일정' })
                    } catch (e) {
                      if ((e as Error).name !== 'AbortError') showToast('공유하지 못했어요. 이미지 저장을 써 주세요.')
                    }
                  }}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] bg-accent text-[14px] font-medium text-white disabled:opacity-40"
                >
                  <Icon name="share" size={15} /> 공유 (카톡 등)
                </button>
              )}
              <button
                disabled={!img}
                onClick={() => {
                  const a = document.createElement('a')
                  a.href = img!.url
                  a.download = weekFileName(week)
                  a.click()
                  showToast('이미지를 저장했어요.')
                }}
                className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[14px] disabled:opacity-40 ${canShare ? 'border border-line-strong hover:bg-hover' : 'bg-accent font-medium text-white'}`}
              >
                <Icon name="download" size={15} /> 이미지 저장
              </button>
              {canCopy && (
                <button
                  disabled={!img}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.write([new ClipboardItem({ 'image/png': img!.blob })])
                      showToast('이미지를 복사했어요. 메신저 입력창에 붙여넣으세요(Ctrl+V).')
                    } catch {
                      showToast('이 브라우저에서는 이미지 복사가 안 돼요. 이미지 저장을 써 주세요.')
                    }
                  }}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[8px] border border-line-strong text-[14px] hover:bg-hover disabled:opacity-40"
                >
                  복사
                </button>
              )}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-hover p-4 max-md:p-3">
            {img ? <img src={img.url} alt="주간 일정 미리보기" className="mx-auto w-full max-w-[460px] rounded-[10px] shadow-pop" /> : <p className="py-20 text-center text-[13px] text-fg3">이미지를 만드는 중…</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
