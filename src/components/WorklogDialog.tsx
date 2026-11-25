import { useEffect, useMemo, useState } from 'react'
import { addDays, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useJournal, useSessions } from '../db'
import { useUI } from '../store'
import { ymd } from '../lib/date'
import { useCalendarItems } from '../lib/subs'
import { loadWorklog, saveWorklog, worklogText, type WorklogOptions } from '../lib/worklog'
import { TagInput } from './TagInput'
import { Icon } from './ui'

/** 일일 업무일지: 미리 보고 고친 뒤 복사·저장 */
export function WorklogDialog() {
  const { showToast } = useUI()
  const close = () => useUI.setState({ worklogOpen: false })
  const [day, setDay] = useState(() => {
    const s = useUI.getState()
    return s.mode === 'day' && s.daySub === 'review' ? s.dayDate : new Date()
  })
  const date = ymd(day)
  const items = useCalendarItems()
  const journal = useJournal(date)
  const sessions = useSessions(date, date)
  const [o, setO] = useState<WorklogOptions>(loadWorklog)
  const set = (p: Partial<WorklogOptions>) => {
    const n = { ...o, ...p }
    setO(n)
    saveWorklog(n)
  }
  const generated = useMemo(() => worklogText(items, date, journal, sessions, o), [items, date, journal, sessions, o])
  const [text, setText] = useState(generated)
  const [edited, setEdited] = useState(false)
  useEffect(() => {
    if (!edited) setText(generated)
  }, [generated, edited])

  const check = (k: keyof WorklogOptions, label: string) => (
    <label className="flex items-center gap-1.5 whitespace-nowrap">
      <input type="checkbox" checked={!!o[k]} onChange={(e) => (set({ [k]: e.target.checked }), setEdited(false))} className="accent-[var(--accent)]" />
      {label}
    </label>
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/30 md:items-start md:px-4 md:pt-[5vh]" onMouseDown={close}>
      <div role="dialog" aria-label="업무일지" onMouseDown={(e) => e.stopPropagation()} className="shadow-pop flex w-full flex-col bg-popover pt-[env(safe-area-inset-top)] md:max-h-[90vh] md:max-w-[680px] md:rounded-[12px] md:pt-0">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3 max-md:px-3">
          <Icon name="checklist" size={17} className="text-fg2" />
          <h2 className="flex-1 text-[16px] font-semibold">업무일지</h2>
          <button onClick={() => (setDay(addDays(day, -1)), setEdited(false))} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="전날">
            <Icon name="left" size={16} />
          </button>
          <span className="tnum text-[14px] font-medium whitespace-nowrap">{format(day, 'M월 d일 (EEE)', { locale: ko })}</span>
          <button onClick={() => (setDay(addDays(day, 1)), setEdited(false))} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="다음날">
            <Icon name="right" size={16} />
          </button>
          <button onClick={close} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-2 border-b border-line px-5 py-3 text-[13px] max-md:px-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {check('byProject', '프로젝트별로 묶기')}
            {check('events', '일정·회의')}
            {check('tomorrow', '내일 할 일')}
            {check('memo', '하루 정리 메모')}
            {check('habits', '습관')}
            {check('tags', '#태그 표시')}
          </div>
          <div className="flex items-center gap-2">
            <span className="shrink-0 text-fg2">빼고 쓸 태그</span>
            <TagInput tags={o.excludeTags} onChange={(t) => (set({ excludeTags: t }), setEdited(false))} placeholder="예: 개인" className="min-w-0 flex-1 border border-line" />
          </div>
        </div>

        <div className="relative min-h-0 flex-1 p-3 max-md:p-2">
          <textarea
            value={text}
            onChange={(e) => (setText(e.target.value), setEdited(true))}
            spellCheck={false}
            className="h-full min-h-[300px] w-full resize-none rounded-[8px] border border-line bg-bg p-3 font-mono text-[13px] leading-[1.7] outline-none focus:border-accent md:min-h-[380px]"
            aria-label="업무일지 내용"
          />
          {edited && (
            <button onClick={() => setEdited(false)} className="absolute top-5 right-5 rounded-[6px] bg-popover px-2 py-0.5 text-[12px] text-fg2 shadow-pop hover:text-fg max-md:top-4 max-md:right-4">
              고친 내용 버리고 다시 만들기
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))] max-md:px-3">
          <span className="text-[12px] text-fg3">완료·진행·이월은 할 일과 하루 정리에서 가져와요. 위 칸에서 바로 고칠 수 있어요.</span>
          <span className="flex-1" />
          <button
            onClick={() => {
              const blob = new Blob(['﻿' + text], { type: 'text/plain;charset=utf-8' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `worklog-${date}.txt`
              a.click()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            }}
            className="rounded-[6px] border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover"
          >
            .txt 저장
          </button>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text)
                showToast('업무일지를 복사했어요. 메일·메신저·사내 시스템에 붙여넣으세요.')
              } catch {
                showToast('복사하지 못했어요. 글을 직접 선택해서 복사해 주세요.')
              }
            }}
            className="flex items-center gap-1.5 rounded-[6px] bg-accent px-4 py-1.5 text-[14px] font-medium text-white hover:brightness-110"
          >
            복사
          </button>
        </div>
      </div>
    </div>
  )
}
