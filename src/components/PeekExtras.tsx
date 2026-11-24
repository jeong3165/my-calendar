import { addMonths, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { updateItem } from '../db'
import type { Item, Repeat } from '../types'
import { parseYmd, ymd } from '../lib/date'
import { baseDate, defaultNth, isLastWeekday, monthlyNthLabel, repeatLabel } from '../lib/recur'
import { REMIND_ALLDAY, REMIND_TIMED, loadNotify, permission, remindLabel } from '../lib/notify'
import { Icon } from './ui'

const WD = ['월', '화', '수', '목', '금', '토', '일']
const UNIT: Record<Repeat['freq'], string> = { daily: '일', weekly: '주', monthly: '개월', yearly: '년' }
const FREQS: [Repeat['freq'] | '', string][] = [
  ['', '반복 안 함'],
  ['daily', '매일'],
  ['weekly', '매주'],
  ['monthly', '매월'],
  ['yearly', '매년'],
]

const pill = (on: boolean) => `rounded-[4px] px-2 py-0.5 text-[13px] ${on ? 'bg-active font-medium text-fg' : 'text-fg2 hover:bg-hover'}`

/** 반복 설정 (항상 반복 원본에 저장) */
export function RepeatEditor({ item, onRemoved }: { item: Item; onRemoved?: () => void }) {
  const base = baseDate(item)
  const r = item.repeat
  if (!base) return <p className="px-2 py-1 text-[13px] text-fg3">날짜를 먼저 정하면 반복할 수 있어요.</p>

  const save = (repeat: Repeat | undefined) => updateItem(item.id, { repeat, ...(repeat ? {} : { exdates: undefined, doneDates: undefined }) })
  const set = (patch: Partial<Repeat>) => r && save({ ...r, ...patch })
  const wd = (parseYmd(base).getDay() + 6) % 7

  return (
    <div className="flex flex-col gap-1.5 px-1 py-[3px]">
      <div className="flex flex-wrap gap-1">
        {FREQS.map(([f, l]) => (
          <button
            key={f}
            onClick={() => {
              if (!f) {
                if (r && !confirm('반복을 끄면 첫 회차 하나만 남아요. 끌까요?')) return
                void save(undefined)
                onRemoved?.()
              } else if (f !== r?.freq) void save({ freq: f, interval: 1, byDay: f === 'weekly' ? [wd] : undefined, monthly: f === 'monthly' ? 'day' : undefined, until: r?.until, count: r?.count })
            }}
            className={pill((r?.freq ?? '') === f)}
          >
            {l}
          </button>
        ))}
      </div>

      {r && (
        <div className="flex flex-col gap-2 rounded-[8px] border border-line px-2.5 py-2 text-[13px]">
          <label className="flex items-center gap-1.5">
            <input
              type="number"
              min={1}
              max={99}
              value={r.interval}
              onChange={(e) => set({ interval: Math.min(99, Math.max(1, Number(e.target.value) || 1)) })}
              className="tnum w-14 rounded-[4px] border border-line bg-transparent px-1.5 py-0.5 text-center outline-none focus:border-accent"
            />
            <span className="text-fg2">{UNIT[r.freq]}마다</span>
          </label>

          {r.freq === 'weekly' && (
            <div className="flex gap-1">
              {WD.map((w, i) => {
                const on = (r.byDay ?? [wd]).includes(i)
                return (
                  <button
                    key={w}
                    onClick={() => {
                      const cur = new Set(r.byDay ?? [wd])
                      if (on) cur.delete(i)
                      else cur.add(i)
                      if (cur.size) set({ byDay: [...cur].sort() })
                    }}
                    className={`grid h-7 w-7 place-items-center rounded-full text-[12px] ${on ? 'bg-accent font-medium text-white' : 'border border-line text-fg2 hover:bg-hover'}`}
                  >
                    {w}
                  </button>
                )
              })}
            </div>
          )}

          {r.freq === 'monthly' && (
            <div className="flex flex-wrap gap-1">
              <button onClick={() => set({ monthly: 'day', nth: undefined })} className={pill(r.monthly !== 'nth')}>
                매월 {parseYmd(base).getDate()}일
              </button>
              {defaultNth(base) !== -1 && (
                <button onClick={() => set({ monthly: 'nth', nth: defaultNth(base) })} className={pill(r.monthly === 'nth' && (r.nth ?? defaultNth(base)) !== -1)}>
                  매월 {monthlyNthLabel(base, defaultNth(base))}
                </button>
              )}
              {isLastWeekday(base) && (
                <button onClick={() => set({ monthly: 'nth', nth: -1 })} className={pill(r.monthly === 'nth' && (r.nth ?? defaultNth(base)) === -1)}>
                  매월 {monthlyNthLabel(base, -1)}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-fg2">종료</span>
            <button onClick={() => set({ until: undefined, count: undefined })} className={pill(!r.until && !r.count)}>
              계속
            </button>
            <button onClick={() => set({ until: ymd(addMonths(parseYmd(base), 3)), count: undefined })} className={pill(!!r.until)}>
              날짜까지
            </button>
            <button onClick={() => set({ count: 10, until: undefined })} className={pill(!!r.count)}>
              횟수
            </button>
            {r.until && (
              <input
                type="date"
                value={r.until}
                min={base}
                onChange={(e) => e.target.value && set({ until: e.target.value })}
                className="tnum rounded-[4px] border border-line bg-transparent px-1.5 py-0.5 outline-none focus:border-accent"
              />
            )}
            {r.count && (
              <label className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={r.count}
                  onChange={(e) => set({ count: Math.min(999, Math.max(1, Number(e.target.value) || 1)) })}
                  className="tnum w-16 rounded-[4px] border border-line bg-transparent px-1.5 py-0.5 text-center outline-none focus:border-accent"
                />
                회
              </label>
            )}
          </div>

          <p className="text-[12px] text-fg3">
            {repeatLabel(r, base)} · {format(parseYmd(base), 'yyyy년 M월 d일 (EEE)', { locale: ko })}부터
            {item.exdates?.length ? ` · 건너뛴 회차 ${item.exdates.length}개` : ''}
          </p>
        </div>
      )}
    </div>
  )
}

/** 알림 설정 (반복이면 원본에 저장 → 모든 회차에 적용) */
export function RemindEditor({ item, timed, onSetup }: { item: Item; timed: boolean; onSetup: () => void }) {
  const list = item.remind ?? []
  const options = (timed ? REMIND_TIMED : REMIND_ALLDAY).filter(([m]) => !list.includes(m))
  const save = (remind: number[]) => updateItem(item.id, { remind: remind.length ? [...remind].sort((a, b) => a - b) : undefined })
  const off = !loadNotify().enabled || permission() !== 'granted'
  const hasDate = !!item.start || !!item.due

  if (!hasDate) return <p className="px-2 py-1 text-[13px] text-fg3">날짜를 정하면 알림을 받을 수 있어요.</p>
  return (
    <div className="flex flex-col gap-1 px-1 py-[3px]">
      <div className="flex flex-wrap items-center gap-1">
        {list.map((m) => (
          <span key={m} className="flex items-center gap-0.5 rounded-[4px] bg-hover py-0.5 pr-0.5 pl-2 text-[13px]">
            {remindLabel(m, timed)}
            <button onClick={() => save(list.filter((x) => x !== m))} className="grid h-5 w-5 place-items-center rounded text-fg3 hover:text-fg" aria-label="알림 빼기">
              <Icon name="x" size={11} />
            </button>
          </span>
        ))}
        {options.length > 0 && (
          <select
            value=""
            onChange={(e) => e.target.value !== '' && save([...list, Number(e.target.value)])}
            className="rounded-[4px] bg-transparent px-1.5 py-0.5 text-[13px] text-fg3 outline-none hover:bg-hover"
            aria-label="알림 추가"
          >
            <option value="">+ 알림 추가</option>
            {options.map(([m, l]) => (
              <option key={m} value={m}>
                {l}
              </option>
            ))}
          </select>
        )}
      </div>
      {list.length > 0 && off && (
        <button onClick={onSetup} className="w-fit px-1 text-left text-[12px] text-[var(--c-orange-bar)] underline underline-offset-2">
          알림이 아직 꺼져 있어요. 켜기 →
        </button>
      )}
    </div>
  )
}
