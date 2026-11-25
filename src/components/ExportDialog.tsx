import { useMemo, useState } from 'react'
import { endOfMonth, endOfWeek, endOfYear, startOfMonth, startOfWeek, startOfYear, subMonths } from 'date-fns'
import { exportJSON } from '../db'
import { useUI } from '../store'
import { WEEK, ymd } from '../lib/date'
import { useCalendarItems } from '../lib/subs'
import { useProjects } from '../lib/projects'
import { buildRows, downloadCsv, toCsv, type CsvOptions } from '../lib/csv'
import { Icon } from './ui'

const now = new Date()
const PRESETS: [string, string, string][] = [
  ['이번 주', ymd(startOfWeek(now, WEEK)), ymd(endOfWeek(now, WEEK))],
  ['이번 달', ymd(startOfMonth(now)), ymd(endOfMonth(now))],
  ['지난달', ymd(startOfMonth(subMonths(now, 1))), ymd(endOfMonth(subMonths(now, 1)))],
  ['올해', ymd(startOfYear(now)), ymd(endOfYear(now))],
]

/** 내보내기: 엑셀(CSV) 또는 전체 백업(JSON) */
export function ExportDialog() {
  const { showToast } = useUI()
  const close = () => useUI.setState({ exportOpen: false })
  const all = useCalendarItems()
  const projects = useProjects()
  const [o, setO] = useState<CsvOptions>({ from: PRESETS[1][1], to: PRESETS[1][2], events: true, tasks: true, undated: false, includeDone: true, projectId: '', subs: false })
  const set = (p: Partial<CsvOptions>) => setO({ ...o, ...p })
  const rows = useMemo(() => (o.from && o.to && o.from <= o.to ? buildRows(all, o) : []), [all, o])
  const preset = PRESETS.find(([, f, t]) => f === o.from && t === o.to)?.[0]

  const check = (k: keyof CsvOptions, label: string) => (
    <label className="flex items-center gap-1.5">
      <input type="checkbox" checked={!!o[k]} onChange={(e) => set({ [k]: e.target.checked })} className="accent-[var(--accent)]" />
      {label}
    </label>
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 md:items-start md:px-4 md:pt-[8vh]" onMouseDown={close}>
      <div role="dialog" aria-label="내보내기" onMouseDown={(e) => e.stopPropagation()} className="shadow-pop flex max-h-[92vh] w-full flex-col gap-4 overflow-y-auto rounded-t-[16px] bg-popover p-5 pb-[max(20px,env(safe-area-inset-bottom))] md:max-w-[520px] md:rounded-[12px]">
        <div className="flex items-center">
          <h2 className="flex-1 text-[16px] font-semibold">엑셀(CSV)로 내보내기</h2>
          <button onClick={close} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>

        <section className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">기간</span>
          <div className="flex flex-wrap gap-1.5">
            {PRESETS.map(([l, f, t]) => (
              <button key={l} onClick={() => set({ from: f, to: t })} className={`rounded-full px-3 py-1 text-[13px] ${preset === l ? 'bg-fg text-bg' : 'border border-line-strong hover:bg-hover'}`}>
                {l}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[13px]">
            <input type="date" value={o.from} onChange={(e) => set({ from: e.target.value })} className="min-w-0 flex-1 rounded-[8px] border border-line-strong bg-bg px-2 py-1.5 outline-none focus:border-accent" aria-label="시작 날짜" />
            ~
            <input type="date" value={o.to} onChange={(e) => set({ to: e.target.value })} className="min-w-0 flex-1 rounded-[8px] border border-line-strong bg-bg px-2 py-1.5 outline-none focus:border-accent" aria-label="끝 날짜" />
          </div>
        </section>

        <section className="flex flex-col gap-2 text-[13px]">
          <span className="font-medium">포함할 것</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {check('events', '일정')}
            {check('tasks', '할 일')}
            {check('includeDone', '완료한 할 일')}
            {check('undated', '날짜 없는 할 일')}
            {check('subs', '구독 캘린더 일정')}
          </div>
          <label className="flex items-center gap-2">
            프로젝트
            <select value={o.projectId} onChange={(e) => set({ projectId: e.target.value })} className="min-w-0 flex-1 rounded-[8px] border border-line-strong bg-bg px-2 py-1.5 outline-none focus:border-accent">
              <option value="">전체</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.icon ?? '📁'} {p.title || '이름 없음'}
                </option>
              ))}
              <option value="none">프로젝트 없음</option>
            </select>
          </label>
        </section>

        <p className="rounded-[8px] bg-hover px-3 py-2 text-[13px] text-fg2">
          {rows.length ? (
            <>
              <b className="text-fg">{rows.length}개</b> 항목 · 유형, 제목, 날짜, 시작·종료, 시간(분), 상태, 우선순위, 프로젝트, 태그, 메모 열
            </>
          ) : (
            '조건에 맞는 항목이 없어요.'
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={async () => {
              await exportJSON()
              showToast('전체 백업 파일(JSON)을 저장했어요.')
            }}
            className="rounded-[6px] px-2.5 py-1.5 text-[13px] text-fg2 hover:bg-hover"
            title="다른 기기에서 '백업 열기'로 되살릴 수 있는 전체 데이터"
          >
            전체 백업(JSON) 저장
          </button>
          <span className="flex-1" />
          <button
            disabled={!rows.length}
            onClick={() => {
              downloadCsv(toCsv(rows), `my-calendar_${o.from}_${o.to}.csv`)
              showToast(`${rows.length}개 항목을 CSV로 저장했어요. 엑셀에서 바로 열려요.`)
              close()
            }}
            className="flex items-center gap-1.5 rounded-[6px] bg-accent px-4 py-1.5 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40"
          >
            <Icon name="download" size={15} /> CSV 저장
          </button>
        </div>
      </div>
    </div>
  )
}
