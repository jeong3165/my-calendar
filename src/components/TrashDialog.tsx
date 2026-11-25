import { differenceInCalendarDays, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { purgeTrash, restoreItem, TRASH_DAYS, useTrash } from '../db'
import { useUI } from '../store'
import type { Item } from '../types'
import { Icon } from './ui'

const TYPE: Record<Item['type'], string> = { event: '일정', task: '할 일', project: '프로젝트', template: '템플릿', dday: '기념일' }

function when(it: Item) {
  const d = it.start ?? it.due ?? it.anniv?.date
  if (!d) return ''
  return d.length === 10 ? d.slice(5).replace('-', '/') : format(new Date(d), 'M/d HH:mm')
}

/** 휴지통: 지운 항목 30일 보관, 되살리기·영구 삭제 */
export function TrashDialog() {
  const { showToast } = useUI()
  const close = () => useUI.setState({ trashOpen: false })
  const list = useTrash()
  const now = new Date()

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/30 md:items-start md:px-4 md:pt-[8vh]" onMouseDown={close}>
      <div role="dialog" aria-label="휴지통" onMouseDown={(e) => e.stopPropagation()} className="shadow-pop flex max-h-[88vh] w-full flex-col rounded-t-[16px] bg-popover pb-[env(safe-area-inset-bottom)] md:max-w-[560px] md:rounded-[12px]">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Icon name="trash" size={17} className="text-fg2" />
          <div className="min-w-0 flex-1">
            <h2 className="text-[16px] font-semibold">휴지통</h2>
            <p className="text-[12px] text-fg3">지운 항목은 {TRASH_DAYS}일 동안 보관되고, 다른 기기에서 지운 것도 여기 보여요.</p>
          </div>
          <button onClick={close} className="grid h-8 w-8 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {list.length === 0 && <li className="px-2 py-10 text-center text-[14px] text-fg3">휴지통이 비어 있어요.</li>}
          {list.map(({ id, deletedAt, item }) => {
            const left = TRASH_DAYS - differenceInCalendarDays(now, new Date(deletedAt))
            return (
              <li key={id} className="group flex items-center gap-2.5 rounded-[8px] px-2 py-2 hover:bg-hover">
                <span className="shrink-0 rounded-[4px] bg-active px-1.5 py-px text-[11px] text-fg2">{TYPE[item.type] ?? '항목'}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px]">
                    {item.icon && <span className="mr-1">{item.icon}</span>}
                    {item.title || '(제목 없음)'}
                  </div>
                  <div className="truncate text-[12px] text-fg3">
                    {when(item) && `${when(item)} · `}
                    {format(new Date(deletedAt), 'M월 d일 a h:mm', { locale: ko })}에 지움 · {left}일 뒤 사라짐
                    {item.tags.length > 0 && ` · ${item.tags.map((t) => '#' + t).join(' ')}`}
                  </div>
                </div>
                <button
                  onClick={async () => {
                    await restoreItem(id)
                    showToast(`"${item.title || '제목 없음'}"을(를) 되살렸어요.`)
                  }}
                  className="shrink-0 rounded-[6px] border border-line-strong px-2.5 py-1 text-[13px] hover:bg-bg"
                >
                  되살리기
                </button>
                <button
                  onClick={async () => {
                    if (!confirm('영구 삭제하면 되살릴 수 없어요. 지울까요?')) return
                    await purgeTrash([id])
                  }}
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-fg3 hover:bg-active hover:text-danger"
                  aria-label="영구 삭제"
                  title="영구 삭제"
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            )
          })}
        </ul>

        {list.length > 0 && (
          <div className="flex items-center gap-2 border-t border-line px-5 py-3">
            <span className="flex-1 text-[12px] text-fg3">{list.length}개</span>
            <button
              onClick={async () => {
                if (!confirm(`휴지통의 ${list.length}개를 모두 영구 삭제할까요?`)) return
                await purgeTrash()
                showToast('휴지통을 비웠어요.')
              }}
              className="rounded-[6px] px-3 py-1.5 text-[13px] text-fg2 hover:bg-hover hover:text-danger"
            >
              휴지통 비우기
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
