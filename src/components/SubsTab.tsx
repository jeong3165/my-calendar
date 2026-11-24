import { useEffect, useState } from 'react'
import { useUI } from '../store'
import { COLORS, COLOR_LABEL, type NotionColor, type Subscription } from '../types'
import { loadSync, ready } from '../lib/sync'
import { checkAutoFetch, newSubId, refreshAll, refreshOne, setSubscriptions, setupAutoFetch, SUB_COLORS, useSubs } from '../lib/subs'
import { ago } from './SettingsDialog'
import { Icon } from './ui'

/** 설정 → 구독 캘린더 */
export function SubsTab() {
  const { list, status, autoFetch } = useSubs()
  const { showToast, setSettings } = useUI()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const syncOn = ready(loadSync())

  useEffect(() => void checkAutoFetch(), [])

  async function add() {
    const u = url.trim()
    if (!/^(https?|webcals?):\/\/\S+/i.test(u)) return setMsg({ ok: false, text: 'http(s):// 또는 webcal:// 로 시작하는 iCal 주소를 넣어 주세요.' })
    if (list.some((s) => s.url.trim() === u)) return setMsg({ ok: false, text: '이미 구독한 주소예요.' })
    const sub: Subscription = { id: newSubId(), name: name.trim() || '구독 캘린더', url: u, color: SUB_COLORS[list.length % SUB_COLORS.length], enabled: true }
    setBusy(true)
    await setSubscriptions([...list, sub])
    await refreshOne(sub)
    setBusy(false)
    setName('')
    setUrl('')
    const st = useSubs.getState().status[sub.id]
    setMsg(st?.state === 'ok' ? { ok: true, text: `"${sub.name}"에서 일정 ${st.count}개를 가져왔어요.` } : { ok: false, text: st?.error ?? '가져오지 못했어요.' })
  }

  const update = (id: string, patch: Partial<Subscription>) => setSubscriptions(list.map((s) => (s.id === id ? { ...s, ...patch } : s)))

  async function turnOnAuto() {
    setBusy(true)
    setMsg(null)
    try {
      await setupAutoFetch()
      setMsg({ ok: true, text: '자동 가져오기를 켰어요. GitHub가 몇 분 안에 처음 받아 오고, 그 뒤로 2시간마다 새로 받아요. 잠시 후 "지금 다시 읽기"를 눌러 보세요.' })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <p className="text-[13px] leading-relaxed text-fg2">
        회사·구글·아웃룩 캘린더의 <b className="text-fg">iCal(.ics) 주소</b>를 넣으면 내 캘린더 위에 <b className="text-fg">읽기 전용</b>으로 함께 보여요. 아침 계획의 하루 부하에도 회의 시간이 반영돼요.
      </p>

      <details className="rounded-[8px] bg-hover px-3 py-2 text-[13px]">
        <summary className="cursor-pointer font-medium">iCal 주소는 어디서 찾나요?</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 leading-relaxed text-fg2">
          <li>
            <b className="text-fg">Google 캘린더</b>: 설정 → 왼쪽에서 캘린더 선택 → "캘린더 통합" → <b className="text-fg">iCal 형식의 비공개 주소</b> 복사
          </li>
          <li>
            <b className="text-fg">Outlook / 회사 메일(Microsoft 365)</b>: 설정 → 캘린더 → 공유 캘린더 → <b className="text-fg">캘린더 게시</b> → "모든 세부 정보 표시"로 게시 → ICS 링크 복사 (회사 정책으로 막혀 있을 수 있어요)
          </li>
          <li>
            <b className="text-fg">iCloud</b>: 캘린더 앱에서 캘린더 공유 → 공개 캘린더 → webcal:// 링크 복사
          </li>
          <li>비공개 주소는 비밀번호처럼 다뤄 주세요. 이 브라우저와 내 비공개 데이터 저장소에만 저장돼요.</li>
        </ul>
      </details>

      <div className="flex flex-col gap-2 rounded-[10px] border border-line p-3">
        <span className="text-[13px] font-medium">새 구독</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름 (예: 회사 캘린더)" className="rounded-[8px] border border-line-strong bg-transparent px-3 py-2 text-[14px] outline-none focus:border-accent" />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
          spellCheck={false}
          className="rounded-[8px] border border-line-strong bg-transparent px-3 py-2 font-mono text-[12px] outline-none focus:border-accent"
        />
        <button onClick={add} disabled={busy || !url.trim()} className="self-end rounded-[6px] bg-accent px-4 py-1.5 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40">
          {busy ? '가져오는 중…' : '구독 추가'}
        </button>
      </div>

      {msg && (
        <p className={`flex items-start gap-1.5 text-[13px] ${msg.ok ? 'text-[var(--c-green-bar)]' : 'text-danger'}`}>
          <Icon name={msg.ok ? 'done' : 'alert'} size={15} className="mt-0.5 shrink-0" />
          {msg.text}
        </p>
      )}

      {list.length > 0 && (
        <ul className="flex flex-col gap-2">
          {list.map((s) => {
            const st = status[s.id]
            return (
              <li key={s.id} className="flex flex-col gap-1.5 rounded-[10px] border border-line p-3">
                <div className="flex items-center gap-2">
                  <ColorPick value={s.color} onChange={(c) => update(s.id, { color: c })} />
                  <input value={s.name} onChange={(e) => update(s.id, { name: e.target.value })} className="min-w-0 flex-1 bg-transparent text-[14px] font-medium outline-none" aria-label="이름" />
                  <label className="flex items-center gap-1 text-[12px] text-fg2">
                    <input type="checkbox" checked={s.enabled} onChange={(e) => update(s.id, { enabled: e.target.checked })} className="accent-[var(--accent)]" />
                    보이기
                  </label>
                  <button onClick={() => refreshOne(s)} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover" title="다시 받기" aria-label="다시 받기">
                    <Icon name="repeat" size={14} />
                  </button>
                  <button
                    onClick={() => confirm(`"${s.name}" 구독을 지울까요? (원래 캘린더는 그대로예요)`) && setSubscriptions(list.filter((x) => x.id !== s.id))}
                    className="grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover hover:text-danger"
                    title="구독 삭제"
                    aria-label="구독 삭제"
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
                <span className="truncate font-mono text-[11px] text-fg3" title="주소">
                  {s.url.replace(/(\/ical\/[^/]{6})[^/]*(\/private-)[^/]*/i, '$1…$2…')}
                </span>
                <span className={`text-[12px] ${st?.state === 'error' ? 'text-danger' : 'text-fg2'}`}>
                  {!st
                    ? '아직 받지 않았어요'
                    : st.state === 'loading'
                      ? '받는 중…'
                      : st.state === 'error'
                        ? st.error
                        : `일정 ${st.count}개 · ${st.method === 'github' ? 'GitHub 자동 가져오기로' : '직접'} 받음 · ${st.fetchedAt ? ago(st.fetchedAt) : ''}${st.unsupported ? ` · 반복 규칙 미지원 ${st.unsupported}개(첫 회차만)` : ''}`}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <section className="flex flex-col gap-2 rounded-[10px] bg-sidebar p-3 text-[13px]">
        <div className="flex items-center gap-2">
          <Icon name="upload" size={15} className="text-fg2" />
          <span className="flex-1 font-medium">GitHub 자동 가져오기</span>
          <span className={autoFetch === 'on' ? 'text-[var(--c-green-bar)]' : 'text-fg3'}>{autoFetch === 'on' ? '켜짐' : autoFetch === 'off' ? '꺼짐' : '확인 중'}</span>
        </div>
        <p className="leading-relaxed text-fg2">
          구글·아웃룩 주소는 보안 정책(CORS) 때문에 브라우저가 직접 읽지 못해요. 대신 <b className="text-fg">내 비공개 데이터 저장소</b>의 GitHub Actions가 2시간마다 받아 두면 앱이 그걸 읽어요. 외부 서버를 거치지
          않아요.
        </p>
        {!syncOn ? (
          <button onClick={() => setSettings(true, 'sync')} className="self-start text-[13px] font-medium text-accent underline underline-offset-2">
            먼저 GitHub 동기화를 켜 주세요 →
          </button>
        ) : (
          <>
            <p className="text-[12px] text-fg3">
              처음 한 번: 동기화에 쓰는 토큰의 권한에 <b>Workflows: Read and write</b>를 추가해야 해요 (GitHub → Settings → Developer settings → Fine-grained tokens → 토큰 → Edit).
            </p>
            <div className="flex flex-wrap gap-2">
              {autoFetch !== 'on' && (
                <button onClick={turnOnAuto} disabled={busy} className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110 disabled:opacity-40">
                  자동 가져오기 켜기
                </button>
              )}
              <button
                onClick={async () => {
                  await refreshAll()
                  showToast('구독 캘린더를 다시 읽었어요.')
                }}
                className="rounded-[6px] border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover"
              >
                지금 다시 읽기
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}

function ColorPick({ value, onChange }: { value: NotionColor; onChange: (c: NotionColor) => void }) {
  return (
    <label className="relative h-4 w-4 shrink-0 cursor-pointer rounded-full" style={{ background: `var(--c-${value}-bar)` }} title="색 바꾸기">
      <select value={value} onChange={(e) => onChange(e.target.value as NotionColor)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="색">
        {COLORS.map((c) => (
          <option key={c} value={c}>
            {COLOR_LABEL[c]}
          </option>
        ))}
      </select>
    </label>
  )
}
