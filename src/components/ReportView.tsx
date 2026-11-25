import { useMemo, useState } from 'react'
import { addMonths, endOfMonth, format, startOfMonth } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useItems, useSessions } from '../db'
import { useUI } from '../store'
import { parseYmd, ymd } from '../lib/date'
import { monthReport, reportText, type MonthReport } from '../lib/report'
import { fmtMinutes } from '../lib/review'
import { taskKey } from '../lib/items'
import { Icon } from './ui'

/** 업무 통계·월간 리포트 (하루 → 월간 리포트) */
export function ReportView() {
  const month = startOfMonth(useUI((s) => s.dayDate))
  const { showToast, open } = useUI()
  const items = useItems()
  // 지난달 비교를 위해 두 달치 집중 기록
  const sessions = useSessions(ymd(addMonths(month, -1)), ymd(endOfMonth(month)))
  const r = useMemo(() => monthReport(items, sessions, month), [items, sessions, month])
  const [metric, setMetric] = useState<'done' | 'focus'>('done')

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportText(r))
      showToast('리포트를 복사했어요. 메일·메신저·문서에 붙여넣으세요.')
    } catch {
      showToast('복사하지 못했어요. 브라우저가 클립보드를 막고 있어요.')
    }
  }

  const empty = !r.completed && !r.events && !r.focusMinutes && !r.created
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[880px] flex-col gap-5 px-6 py-5 max-md:px-3 max-md:py-3">
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-[18px] font-semibold max-md:text-[16px]">{r.label} 리포트</h2>
          <button onClick={() => useUI.setState({ exportOpen: true })} className="flex h-8 items-center gap-1.5 rounded-[6px] border border-line-strong px-3 text-[13px] hover:bg-hover">
            <Icon name="download" size={14} /> 엑셀로
          </button>
          <button onClick={copy} className="flex h-8 items-center gap-1.5 rounded-[6px] bg-accent px-3 text-[13px] font-medium text-white hover:brightness-110">
            <Icon name="checklist" size={14} /> <span className="max-md:hidden">보고용 </span>글 복사
          </button>
        </div>

        {empty ? (
          <p className="rounded-[10px] bg-hover px-4 py-8 text-center text-[14px] text-fg2">이 달에는 기록이 없어요. 할 일을 끝내거나 집중 타이머를 쓰면 여기에 쌓여요.</p>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 max-md:grid-cols-2">
              <Stat label="완료한 할 일" value={`${r.completed}개`} delta={r.completed - r.prev.completed} unit="개" />
              <Stat label="집중 시간" value={fmtMinutes(r.focusMinutes)} sub={`${r.focusCount}회`} delta={r.focusMinutes - r.prev.focusMinutes} unit="분" />
              <Stat label="일정" value={`${r.events}개`} sub={r.eventMinutes ? `총 ${fmtMinutes(Math.round(r.eventMinutes))}` : undefined} delta={r.events - r.prev.events} unit="개" />
              <Stat label="습관 달성률" value={r.habit.due ? `${Math.round((r.habit.done / r.habit.due) * 100)}%` : '—'} sub={r.habit.due ? `${r.habit.done} / ${r.habit.due}회` : '습관 없음'} />
            </div>

            <section className="rounded-[10px] border border-line p-4 max-md:p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h3 className="flex-1 text-[14px] font-semibold">날짜별 {metric === 'done' ? '완료한 할 일·습관' : '집중 시간'}</h3>
                <div className="flex rounded-[6px] bg-hover p-0.5 text-[12.5px]" role="tablist" aria-label="그래프 기준">
                  {(
                    [
                      ['done', '완료'],
                      ['focus', '집중 시간'],
                    ] as const
                  ).map(([k, l]) => (
                    <button key={k} role="tab" aria-selected={metric === k} onClick={() => setMetric(k)} className={`h-6 rounded-[5px] px-2.5 ${metric === k ? 'bg-bg font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <DayBars r={r} metric={metric} />
              {r.busiest && metric === 'done' && (
                <p className="mt-2 text-[12px] text-fg3">
                  가장 많이 끝낸 날: {format(parseYmd(r.busiest.date), 'M월 d일 (EEE)', { locale: ko })} · {r.busiest.done}개
                </p>
              )}
            </section>

            {r.projects.length > 0 && (
              <section className="rounded-[10px] border border-line p-4 max-md:p-3">
                <h3 className="mb-2 text-[14px] font-semibold">프로젝트별 진행</h3>
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[12px] text-fg3">
                      <th className="py-1 font-normal">프로젝트</th>
                      <th className="w-[38%] py-1 font-normal max-md:w-[30%]">진행률</th>
                      <th className="py-1 text-right font-normal">이번 달</th>
                      <th className="py-1 text-right font-normal max-md:hidden">집중</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.projects.map((p) => {
                      const pct = p.total ? Math.round((p.done / p.total) * 100) : 0
                      return (
                        <tr key={p.id} className="border-t border-line">
                          <td className="py-2 pr-2">
                            <button onClick={() => useUI.getState().openProject(p.id)} className="flex max-w-full items-center gap-1.5 truncate text-left hover:underline">
                              <span>{p.icon}</span>
                              <span className="truncate">{p.title}</span>
                            </button>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="flex items-center gap-2" title={`${p.done} / ${p.total} 완료`}>
                              <div className="h-2 flex-1 overflow-hidden rounded-full bg-active">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: `var(--c-${p.color}-bar)` }} />
                              </div>
                              <span className="tnum shrink-0 whitespace-nowrap text-right text-[12px] text-fg2">
                                {p.done}/{p.total} · {pct}%
                              </span>
                            </div>
                          </td>
                          <td className="tnum py-2 text-right">{p.doneThisMonth}개</td>
                          <td className="tnum py-2 text-right text-fg2 max-md:hidden">{p.focus ? fmtMinutes(p.focus) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </section>
            )}

            <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1">
              {r.tags.length > 0 && (
                <section className="rounded-[10px] border border-line p-4 max-md:p-3">
                  <h3 className="mb-2 text-[14px] font-semibold">태그별 쓴 시간</h3>
                  <ul className="flex flex-col gap-2">
                    {r.tags.map((t) => (
                      <li key={t.tag} className="grid grid-cols-[minmax(0,90px)_1fr_auto] items-center gap-2 text-[13px]" title={`${t.count}개 일정`}>
                        <span className="truncate">{t.tag}</span>
                        <div className="h-2 overflow-hidden rounded-full bg-active">
                          <div className="h-full rounded-full bg-accent" style={{ width: `${(t.minutes / r.tags[0].minutes) * 100}%` }} />
                        </div>
                        <span className="tnum text-[12px] text-fg2">{fmtMinutes(Math.round(t.minutes))}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {r.slipped.length > 0 && (
                <section className="rounded-[10px] border border-line p-4 max-md:p-3">
                  <h3 className="mb-2 text-[14px] font-semibold text-danger">마감 지났는데 못 끝낸 일 {r.slipped.length}</h3>
                  <ul className="flex flex-col">
                    {r.slipped.slice(0, 10).map((t) => (
                      <li key={t.id}>
                        <button onClick={() => open(t.id)} className="flex w-full items-center gap-2 rounded-[6px] px-1 py-1 text-left text-[13px] hover:bg-hover">
                          <span className="min-w-0 flex-1 truncate">{t.title || '(제목 없음)'}</span>
                          <span className="tnum text-[12px] text-fg3">{taskKey(t)?.slice(5).replace('-', '/')}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, sub, delta, unit }: { label: string; value: string; sub?: string; delta?: number; unit?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-[10px] border border-line px-4 py-3 max-md:px-3">
      <span className="text-[12px] text-fg2">{label}</span>
      <span className="tnum text-[24px] leading-tight font-semibold max-md:text-[20px]">{value}</span>
      <span className="text-[11.5px] text-fg3">
        {sub}
        {sub && delta !== undefined && ' · '}
        {delta !== undefined && (delta === 0 ? '지난달과 같아요' : `지난달보다 ${delta > 0 ? '▲' : '▼'} ${unit === '분' ? fmtMinutes(Math.abs(delta)) : `${Math.abs(delta)}${unit}`}`)}
      </span>
    </div>
  )
}

/** 날짜별 막대 (한 가지 값만 → 범례 없이 제목으로, 막대에 마우스를 올리면 값) */
function DayBars({ r, metric }: { r: MonthReport; metric: 'done' | 'focus' }) {
  const [hover, setHover] = useState<number | null>(null)
  const vals = r.days.map((d) => (metric === 'done' ? d.done : d.focus))
  const max = Math.max(1, ...vals)
  const nice = metric === 'done' ? Math.max(2, Math.ceil(max / 2) * 2) : Math.max(60, Math.ceil(max / 60) * 60)
  const fmt = (v: number) => (metric === 'done' ? `${v}개` : fmtMinutes(v))
  const today = ymd(new Date())
  const H = 140
  return (
    <div className="relative">
      <div className="flex">
        <div className="tnum flex w-10 shrink-0 flex-col justify-between pr-1.5 text-right text-[11px] text-fg3" style={{ height: H }}>
          <span>{metric === 'done' ? nice : fmtMinutes(nice)}</span>
          <span>{metric === 'done' ? nice / 2 : fmtMinutes(nice / 2)}</span>
          <span>0</span>
        </div>
        <div className="relative min-w-0 flex-1" onMouseLeave={() => setHover(null)}>
          {/* 눈금선은 흐리게 */}
          {[0, 0.5, 1].map((f) => (
            <div key={f} className="absolute inset-x-0 border-t border-line" style={{ top: H * (1 - f) }} />
          ))}
          <div className="relative flex items-end gap-[2px]" style={{ height: H }}>
            {vals.map((v, i) => (
              <div
                key={r.days[i].date}
                className="flex h-full flex-1 cursor-default items-end"
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(hover === i ? null : i)}
                aria-label={`${Number(r.days[i].date.slice(8))}일 ${fmt(v)}`}
              >
                {v > 0 && <div className={`w-full rounded-t-[4px] ${hover === i ? 'bg-accent' : 'bg-accent/75'}`} style={{ height: `${(v / nice) * 100}%`, minHeight: 3 }} />}
              </div>
            ))}
          </div>
          <div className="tnum mt-1 flex gap-[2px] text-[10.5px] text-fg3">
            {r.days.map((d, i) => (
              <span key={d.date} className={`flex-1 text-center ${d.date === today ? 'font-semibold text-today' : ''}`}>
                {i === 0 || (i + 1) % 5 === 0 || d.date === today ? i + 1 : ''}
              </span>
            ))}
          </div>
          {hover !== null && (
            <div
              className="shadow-pop pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-[8px] bg-popover px-2.5 py-1.5 text-[12px] whitespace-nowrap"
              style={{ left: `${((hover + 0.5) / vals.length) * 100}%` }}
            >
              <div className="text-fg2">{format(parseYmd(r.days[hover].date), 'M월 d일 (EEE)', { locale: ko })}</div>
              <div className="font-semibold">{fmt(vals[hover])}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
