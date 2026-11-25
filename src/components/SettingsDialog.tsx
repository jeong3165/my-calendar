import { useState, type ReactNode } from 'react'
import { LAYOUT_DEFAULT, useUI } from '../store'
import { MODELS, loadSettings, saveSettings } from '../lib/importFiles'
import { loadSync, saveSync, syncNow, testConnection, useSync } from '../lib/sync'
import { Icon } from './ui'
import { SubsTab } from './SubsTab'
import { REMIND_ALLDAY, REMIND_TIMED, loadNotify, permission, saveNotify, showSystemNotification } from '../lib/notify'
import { loadBriefing, saveBriefing } from '../lib/briefing'

export function SettingsDialog() {
  const { setSettings, settingsTab } = useUI()
  const [tab, setTab] = useState(settingsTab)

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 px-4 pt-[8vh]" onMouseDown={() => setSettings(false)}>
      <div role="dialog" aria-label="설정" onMouseDown={(e) => e.stopPropagation()} className="shadow-pop flex max-h-[84vh] w-full max-w-[600px] flex-col rounded-[12px] bg-popover">
        <div className="flex items-center gap-2 border-b border-line px-5 pt-3 max-md:px-2">
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]" role="tablist">
            {(
              [
                ['display', '화면'],
                ['sync', 'GitHub 동기화'],
                ['subs', '구독 캘린더'],
                ['notify', '알림'],
                ['ai', 'AI'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-2.5 pb-2.5 text-[14px] max-md:px-2 max-md:text-[13.5px] ${tab === k ? 'border-fg font-semibold' : 'border-transparent text-fg2 hover:text-fg'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <button onClick={() => setSettings(false)} className="mb-2 grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{tab === 'display' ? <DisplayTab /> : tab === 'ai' ? <AITab /> : tab === 'notify' ? <NotifyTab /> : tab === 'subs' ? <SubsTab /> : <SyncTab />}</div>
      </div>
    </div>
  )
}

/* ───────── GitHub 동기화 ───────── */
/** 저장소 입력 정리: 주소 전체를 붙여넣어도 "아이디/이름"만 남긴다 (입력 중에는 건드리지 않음) */
export function normalizeRepo(v: string) {
  return v
    .trim()
    .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
    .split('/')
    .slice(0, 2)
    .join('/')
}
function SyncTab() {
  const { setSettings, showToast } = useUI()
  const [s, setS] = useState(loadSync)
  const [show, setShow] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const st = useSync()

  async function test() {
    setBusy(true)
    setMsg(null)
    const clean = { ...s, repo: normalizeRepo(s.repo) }
    setS(clean)
    try {
      setMsg({ ok: true, text: await testConnection(clean) })
      return true
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function enable() {
    if (!(await test())) return
    const next = { ...s, repo: normalizeRepo(s.repo), enabled: true }
    saveSync(next)
    setS(next)
    useSync.setState({ status: 'idle', lastSig: null })
    await syncNow()
    const after = useSync.getState()
    if (after.status === 'error') setMsg({ ok: false, text: after.error ?? '동기화 실패' })
    else {
      showToast('동기화를 켰어요. 이제 이 기기의 일정이 저장소와 자동으로 맞춰져요.')
      setSettings(false)
    }
  }

  function disable() {
    const next = { ...s, enabled: false }
    saveSync(next)
    setS(next)
    useSync.setState({ status: 'off', error: null })
    showToast('동기화를 껐어요. 이 기기의 데이터는 그대로 남아 있어요.')
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <p className="text-[13px] leading-relaxed text-fg2">
        일정을 GitHub <b className="text-fg">비공개 저장소</b>에 저장해서 회사·집·휴대폰에서 같은 데이터를 써요. 고칠 때마다 자동으로 저장되고, 저장 기록(커밋)이 남아서 예전
        상태로 되돌릴 수도 있어요.
      </p>

      <details className="rounded-[8px] bg-hover px-3 py-2 text-[13px]" open={!s.enabled}>
        <summary className="cursor-pointer font-medium">처음 한 번 준비하기</summary>
        <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-5 leading-relaxed text-fg2">
          <li>
            <Ext href="https://github.com/new">github.com/new</Ext> 에서 <b className="text-fg">Private</b> 저장소를 만들어요. 예: <code>my-calendar-data</code>
          </li>
          <li>
            <Ext href="https://github.com/settings/personal-access-tokens/new">토큰 만들기(Fine-grained)</Ext>에서
            <br />· Repository access: <b className="text-fg">Only select repositories</b> → 방금 만든 저장소만
            <br />· Permissions → Repository → <b className="text-fg">Contents: Read and write</b>
            <br />· 만료일은 원하는 대로(예: 1년). 만들어진 토큰(github_pat_…)을 복사해요.
          </li>
          <li>아래에 저장소 이름과 토큰을 넣고 <b className="text-fg">동기화 켜기</b>를 눌러요. 다른 기기에서도 같은 값을 넣으면 돼요.</li>
        </ol>
      </details>

      <Row label="저장소 (아이디/이름)">
        <input
          value={s.repo}
          onChange={(e) => setS({ ...s, repo: e.target.value })}
          onBlur={() => setS((cur) => ({ ...cur, repo: normalizeRepo(cur.repo) }))}
          placeholder="jeong3165/my-calendar-data"
          spellCheck={false}
          className="w-full bg-transparent px-3 py-2 font-mono text-[13px] outline-none"
        />
      </Row>
      <Row label="토큰" hint="이 브라우저에만 저장돼요. 이 저장소 하나에만 권한을 준 토큰을 쓰세요.">
        <div className="flex items-center">
          <input
            type={show ? 'text' : 'password'}
            value={s.token}
            onChange={(e) => setS({ ...s, token: e.target.value.trim() })}
            placeholder="github_pat_..."
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-[13px] outline-none"
          />
          <button onClick={() => setShow(!show)} className="px-3 text-[12px] text-fg2 hover:text-fg">
            {show ? '숨기기' : '보기'}
          </button>
        </div>
      </Row>
      <Row label="파일 이름">
        <input value={s.path} onChange={(e) => setS({ ...s, path: e.target.value.trim() || 'calendar.json' })} className="w-full bg-transparent px-3 py-2 font-mono text-[13px] outline-none" />
      </Row>

      {msg && (
        <p className={`flex items-start gap-1.5 text-[13px] ${msg.ok ? 'text-[var(--c-green-bar)]' : 'text-danger'}`}>
          <Icon name={msg.ok ? 'done' : 'alert'} size={15} className="mt-0.5" />
          {msg.text}
        </p>
      )}
      {s.enabled && (
        <p className="text-[13px] text-fg2">
          현재 상태: <SyncLabel />
          {st.error && <span className="block text-danger">{st.error}</span>}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button onClick={test} disabled={busy} className="rounded-[6px] border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover disabled:opacity-50">
          연결 테스트
        </button>
        <div className="flex gap-2">
          {s.enabled && (
            <button onClick={disable} className="rounded-[6px] px-3 py-1.5 text-[13px] text-fg2 hover:bg-hover hover:text-danger">
              동기화 끄기
            </button>
          )}
          <button onClick={enable} disabled={busy} className="rounded-[6px] bg-accent px-4 py-1.5 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-50">
            {busy ? '확인 중…' : s.enabled ? '저장하고 지금 동기화' : '동기화 켜기'}
          </button>
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-fg3">
        처음 켤 때 이 기기의 일정과 저장소의 일정이 <b>합쳐져요</b> (어느 쪽도 지워지지 않아요). 같은 항목을 두 곳에서 고쳤다면 나중에 고친 쪽이 남아요.
      </p>
    </div>
  )
}

export function SyncLabel() {
  const { status, lastSync } = useSync()
  if (status === 'off') return <>꺼짐</>
  if (status === 'syncing') return <>동기화 중…</>
  if (status === 'offline') return <>오프라인 (연결되면 자동으로 맞춰요)</>
  if (status === 'error') return <span className="text-danger">오류</span>
  return <>{lastSync ? `동기화됨 · ${ago(lastSync)}` : '대기 중'}</>
}

export function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return '방금'
  if (s < 3600) return `${Math.floor(s / 60)}분 전`
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`
  return `${Math.floor(s / 86400)}일 전`
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-medium text-accent underline underline-offset-2">
      {children}
    </a>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      <div className="rounded-[8px] border border-line-strong focus-within:border-accent">{children}</div>
      {hint && <span className="text-[12px] text-fg2">{hint}</span>}
    </label>
  )
}

/* ───────── AI ───────── */
function AITab() {
  const { setSettings, showToast } = useUI()
  const [s, setS] = useState(loadSettings)
  const [show, setShow] = useState(false)
  const [check, setCheck] = useState<{ state: 'idle' | 'busy' } | { state: 'ok'; text: string } | { state: 'bad'; text: string; detail: string }>({ state: 'idle' })
  const key = s.apiKey
  const shape = !key ? '' : !key.startsWith('sk-ant-') ? '키는 보통 sk-ant- 로 시작해요. 다른 값을 붙여넣지 않았는지 확인해 주세요.' : key.length < 60 ? '키가 너무 짧아요. 일부만 복사된 것 같아요.' : ''

  async function test() {
    setCheck({ state: 'busy' })
    const { checkKey } = await import('../lib/ai')
    const r = await checkKey(s.apiKey, s.model)
    setCheck(r.ok ? { state: 'ok', text: `연결됐어요 · ${r.name} 사용 가능` } : { state: 'bad', text: r.message, detail: r.detail })
  }

  return (
    <div className="flex flex-col gap-4 p-5">
      <Row label="Claude API 키" hint="Claude Console(platform.claude.com)에서 발급받아요. 이 브라우저에만 저장되고, 분석할 때 Anthropic API로만 보내요. 공용 컴퓨터에서는 쓰지 마세요.">
        <div className="flex items-center">
          <input
            type={show ? 'text' : 'password'}
            value={s.apiKey}
            onChange={(e) => (setS({ ...s, apiKey: e.target.value.replace(/[\s\u200b-\u200d\ufeff]/g, '') }), setCheck({ state: 'idle' }))}
            placeholder="sk-ant-..."
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-[13px] outline-none"
          />
          <button onClick={() => setShow(!show)} className="px-3 text-[12px] text-fg2 hover:text-fg">
            {show ? '숨기기' : '보기'}
          </button>
        </div>
      </Row>

      {shape && <p className="-mt-2 text-[12.5px] text-[var(--c-orange-bar)]">{shape}</p>}
      <div className="-mt-1 flex flex-wrap items-center gap-2">
        <button onClick={test} disabled={!key || check.state === 'busy'} className="rounded-[6px] border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover disabled:opacity-40">
          {check.state === 'busy' ? '확인 중…' : '키 확인 (요금 없음)'}
        </button>
        {check.state === 'ok' && (
          <span className="flex flex-col text-[13px] text-[var(--c-green-bar)]">
            ✓ {check.text}
            <span className="text-[11.5px] text-fg3">크레딧 잔액은 여기서 확인되지 않아요. platform.claude.com → Billing에서 볼 수 있어요.</span>
          </span>
        )}
        {check.state === 'bad' && (
          <span className="flex flex-col text-[13px] text-danger">
            {check.text}
            <span className="font-mono text-[11px] text-fg3">{check.detail}</span>
          </span>
        )}
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">모델</span>
        <select value={s.model} onChange={(e) => (setS({ ...s, model: e.target.value }), setCheck({ state: 'idle' }))} className="rounded-[8px] border border-line-strong bg-bg px-2.5 py-2 text-[14px] outline-none focus:border-accent">
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="text-[12px] text-fg2">흐린 사진이나 손글씨는 Opus가 가장 잘 읽어요. 깔끔한 스크린샷 위주라면 Sonnet도 충분해요.</span>
      </label>

      <div className="flex justify-between gap-2 pt-1">
        <button
          onClick={() => {
            saveSettings({ ...s, apiKey: '' })
            setS({ ...s, apiKey: '' })
            showToast('API 키를 지웠어요.')
          }}
          className="rounded-[6px] px-3 py-1.5 text-[13px] text-fg2 hover:bg-hover hover:text-danger"
        >
          키 지우기
        </button>
        <button
          onClick={() => {
            saveSettings(s)
            setSettings(false)
            showToast('설정을 저장했어요.')
          }}
          className="rounded-[6px] bg-accent px-4 py-1.5 text-[14px] font-medium text-white hover:brightness-110"
        >
          저장
        </button>
      </div>
    </div>
  )
}

/* ───────── 알림 ───────── */
function NotifyTab() {
  const { showToast } = useUI()
  const [s, setS] = useState(loadNotify)
  const [perm, setPerm] = useState(permission)
  const [msg, setMsg] = useState<string | null>(null)
  const update = (next: typeof s) => {
    setS(next)
    saveNotify(next)
  }

  async function turnOn() {
    setMsg(null)
    if (perm === 'unsupported') return setMsg('이 브라우저(또는 파일로 연 앱)에서는 시스템 알림을 쓸 수 없어요. 앱 안의 알림 메시지로만 알려 드려요.')
    let p = perm
    if (p === 'default') p = await Notification.requestPermission()
    setPerm(p)
    if (p === 'denied') {
      update({ ...s, enabled: true })
      return setMsg('브라우저에서 알림이 차단되어 있어요. 주소창 왼쪽 자물쇠(또는 설정) 아이콘 → 사이트 권한 → 알림 → "허용"으로 바꾼 뒤 이 창을 다시 열어 주세요. 그 전까지는 앱 안 메시지로만 알려 드려요.')
    }
    update({ ...s, enabled: true })
    showToast('알림을 켰어요.')
  }

  const sel = (value: number[], options: [number, string][], onChange: (v: number[]) => void) => (
    <select
      value={value[0] ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? [] : [Number(e.target.value)])}
      className="rounded-[8px] border border-line-strong bg-bg px-2.5 py-1.5 text-[14px] outline-none focus:border-accent"
    >
      <option value="">알림 없음</option>
      {options.map(([m, l]) => (
        <option key={m} value={m}>
          {l}
        </option>
      ))}
    </select>
  )

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-center gap-3 rounded-[8px] bg-hover px-3 py-2.5">
        <Icon name="bell" size={18} className={s.enabled ? 'text-accent' : 'text-fg3'} />
        <div className="flex-1 text-[13px]">
          <div className="font-medium">{s.enabled ? '알림 켜짐' : '알림 꺼짐'}</div>
          <div className="text-fg2">
            시스템 알림 권한: {perm === 'granted' ? '허용됨' : perm === 'denied' ? '차단됨' : perm === 'unsupported' ? '지원 안 됨' : '아직 묻지 않음'}
          </div>
        </div>
        {s.enabled ? (
          <button onClick={() => update({ ...s, enabled: false })} className="rounded-[6px] px-3 py-1.5 text-[13px] text-fg2 hover:bg-active">
            끄기
          </button>
        ) : (
          <button onClick={turnOn} className="rounded-[6px] bg-accent px-3 py-1.5 text-[13px] font-medium text-white hover:brightness-110">
            알림 켜기
          </button>
        )}
      </div>
      {msg && <p className="text-[13px] text-[var(--c-orange-bar)]">{msg}</p>}

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">새 일정의 기본 알림 (시간 있는 일정)</span>
        {sel(s.defaultTimed, REMIND_TIMED, (v) => update({ ...s, defaultTimed: v }))}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">새 일정의 기본 알림 (종일 일정)</span>
        {sel(s.defaultAllDay, REMIND_ALLDAY, (v) => update({ ...s, defaultAllDay: v }))}
      </label>

      <button
        onClick={async () => {
          const ok = await showSystemNotification('알림 테스트', '이렇게 알려 드려요 · 오늘 15:00–16:00', { id: '' }, 'test')
          showToast(ok ? '테스트 알림을 보냈어요.' : '🔔 알림 테스트 · 시스템 알림 권한이 없어서 앱 안에서만 보여요.')
        }}
        className="w-fit rounded-[6px] border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover"
      >
        테스트 알림 보내기
      </button>

      <BriefingSection />

      <ul className="flex list-disc flex-col gap-1 pl-4 text-[12px] leading-relaxed text-fg2">
        <li>
          알림은 <b className="text-fg">앱이 열려 있을 때</b>(창을 최소화하거나 다른 탭에 있어도 됨) 울려요. 완전히 닫혀 있으면 울리지 않아요. Edge의 "앱으로 설치"로 띄워 두면 편해요.
        </li>
        <li>항목마다 알림은 상세 화면의 🔔 알림에서 바꿀 수 있어요. 반복 일정은 모든 회차에 적용돼요.</li>
        <li>알림 켜기는 기기(브라우저)마다 따로 해야 해요. 휴대폰에서는 "홈 화면에 추가"한 앱으로 열어 두세요.</li>
      </ul>
    </div>
  )
}

/* ───────── 아침 브리핑 ───────── */
function BriefingSection() {
  const [b, setB] = useState(loadBriefing)
  const update = (patch: Partial<typeof b>) => {
    const next = { ...b, ...patch }
    setB(next)
    saveBriefing(next)
  }
  const hasKey = !!loadSettings().apiKey
  return (
    <section className="flex flex-col gap-3 rounded-[10px] border border-line p-3.5">
      <div className="flex items-center gap-2.5">
        <span className="text-[20px] leading-none">☀️</span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">아침 브리핑</div>
          <div className="text-[12px] text-fg2">정한 시각에 오늘 일정·할 일·밀린 일·곧 마감을 한눈에 보여 줘요.</div>
        </div>
        <button
          role="switch"
          aria-checked={b.enabled}
          aria-label="아침 브리핑"
          onClick={() => update({ enabled: !b.enabled })}
          className={`relative h-6 w-10 shrink-0 rounded-full transition-colors ${b.enabled ? 'bg-accent' : 'bg-active'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left] ${b.enabled ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>
      <div className={`flex flex-col gap-3 ${b.enabled ? '' : 'pointer-events-none opacity-50'}`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
          <label className="flex items-center gap-2">
            시각
            <input type="time" value={b.time} onChange={(e) => e.target.value && update({ time: e.target.value })} className="rounded-[8px] border border-line-strong bg-bg px-2 py-1 outline-none focus:border-accent" />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={b.weekdaysOnly} onChange={(e) => update({ weekdaysOnly: e.target.checked })} className="accent-[var(--accent)]" />
            평일만 (주말 쉬기)
          </label>
        </div>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" checked={b.ai} onChange={(e) => update({ ai: e.target.checked })} className="mt-0.5 accent-[var(--accent)]" />
          <span>
            <b className="font-medium">AI 한마디</b> — Claude가 오늘 먼저 챙길 일과 짧은 조언을 써 줘요 (하루 한 번 · Opus 기준 대략 20~40원, Haiku는 거의 무료).
            {!hasKey && <span className="text-[var(--c-orange-bar)]"> AI 탭에서 API 키를 먼저 넣어 주세요.</span>}
          </span>
        </label>
        {b.ai && (
          <label className="flex items-center gap-2 pl-6 text-[13px]">
            날씨 도시
            <input
              value={b.city}
              onChange={(e) => update({ city: e.target.value })}
              placeholder="예: 서울 강남구 (비우면 날씨 없음)"
              className="min-w-0 flex-1 rounded-[8px] border border-line-strong bg-bg px-2 py-1 outline-none focus:border-accent"
            />
          </label>
        )}
        {b.ai && b.city.trim() && <p className="pl-6 text-[12px] text-fg3">날씨는 웹 검색으로 찾아요. 검색과 검색 결과 읽기로 하루 대략 50~100원이 더 들어요.</p>}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => (useUI.setState({ briefingOpen: true }), useUI.getState().setSettings(false))} className="w-fit rounded-[6px] border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover">
          지금 미리 보기
        </button>
        <span className="text-[12px] text-fg3">하루 한 번, 정한 시각 이후 앱을 처음 볼 때(오후 3시까지) 떠요.</span>
      </div>
    </section>
  )
}

/* ───────── 화면 크기 ───────── */
function DisplayTab() {
  const { uiScale, hourH, sidebarW, peekW, setLayout } = useUI()
  const row = (label: string, hint: string, control: React.ReactNode) => (
    <div className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium">{label}</span>
      {control}
      <span className="text-[12px] text-fg3">{hint}</span>
    </div>
  )
  return (
    <div className="flex flex-col gap-5 p-5">
      {row(
        `화면 크기 ${Math.round(uiScale * 100)}%`,
        '글자·버튼·칸이 함께 커지거나 작아져요. 이 브라우저에만 적용돼요.',
        <div className="flex items-center gap-2">
          <button onClick={() => setLayout({ uiScale: Math.max(0.8, Math.round((uiScale - 0.05) * 100) / 100) })} className="h-8 w-8 rounded-[6px] border border-line-strong text-[16px] hover:bg-hover" aria-label="작게">
            −
          </button>
          <input type="range" min={0.8} max={1.4} step={0.05} value={uiScale} onChange={(e) => setLayout({ uiScale: Number(e.target.value) })} className="flex-1 accent-[var(--accent)]" aria-label="화면 크기" />
          <button onClick={() => setLayout({ uiScale: Math.min(1.4, Math.round((uiScale + 0.05) * 100) / 100) })} className="h-8 w-8 rounded-[6px] border border-line-strong text-[16px] hover:bg-hover" aria-label="크게">
            +
          </button>
        </div>,
      )}
      {row(
        `캘린더 시간 칸 높이 ${hourH}px (1시간)`,
        '주·일 보기에서 Ctrl(⌘) + 마우스 휠로도 바꿀 수 있어요. 높이면 짧은 일정도 글씨가 잘 보여요.',
        <input type="range" min={28} max={120} step={2} value={hourH} onChange={(e) => setLayout({ hourH: Number(e.target.value) })} className="accent-[var(--accent)]" aria-label="시간 칸 높이" />,
      )}
      {row(
        `사이드바 ${sidebarW}px · 상세 패널 ${peekW}px`,
        '사이드바 오른쪽 경계, 상세 패널 왼쪽 경계를 끌어서 바꿀 수 있어요. 경계를 두 번 누르면 기본값으로 돌아가요.',
        <div className="flex flex-wrap gap-2">
          <input type="range" min={220} max={440} value={sidebarW} onChange={(e) => setLayout({ sidebarW: Number(e.target.value) })} className="flex-1 accent-[var(--accent)]" aria-label="사이드바 너비" />
          <input type="range" min={360} max={760} value={peekW} onChange={(e) => setLayout({ peekW: Number(e.target.value) })} className="flex-1 accent-[var(--accent)]" aria-label="상세 패널 너비" />
        </div>,
      )}
      <button onClick={() => setLayout(LAYOUT_DEFAULT)} className="self-start rounded-[6px] border border-line-strong px-3 py-1.5 text-[13px] hover:bg-hover">
        모두 기본값으로
      </button>
    </div>
  )
}
