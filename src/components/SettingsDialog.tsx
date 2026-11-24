import { useState, type ReactNode } from 'react'
import { useUI } from '../store'
import { MODELS, loadSettings, saveSettings } from '../lib/importFiles'
import { loadSync, saveSync, syncNow, testConnection, useSync } from '../lib/sync'
import { Icon } from './ui'

export function SettingsDialog() {
  const { setSettings, settingsTab } = useUI()
  const [tab, setTab] = useState(settingsTab)

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 px-4 pt-[8vh]" onMouseDown={() => setSettings(false)}>
      <div role="dialog" aria-label="설정" onMouseDown={(e) => e.stopPropagation()} className="shadow-pop flex max-h-[84vh] w-full max-w-[520px] flex-col rounded-[12px] bg-popover">
        <div className="flex items-center gap-2 border-b border-line px-5 pt-3">
          <div className="flex flex-1 gap-1" role="tablist">
            {(
              [
                ['sync', 'GitHub 동기화'],
                ['ai', 'AI (캡처로 추가)'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={`-mb-px border-b-2 px-2.5 pb-2.5 text-[14px] ${tab === k ? 'border-fg font-semibold' : 'border-transparent text-fg2 hover:text-fg'}`}
              >
                {l}
              </button>
            ))}
          </div>
          <button onClick={() => setSettings(false)} className="mb-2 grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto">{tab === 'ai' ? <AITab /> : <SyncTab />}</div>
      </div>
    </div>
  )
}

/* ───────── GitHub 동기화 ───────── */
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
    try {
      setMsg({ ok: true, text: await testConnection(s) })
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
    const next = { ...s, enabled: true }
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
          onChange={(e) => setS({ ...s, repo: e.target.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$|\/$/g, '') })}
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

  return (
    <div className="flex flex-col gap-4 p-5">
      <Row label="Claude API 키" hint="Claude Console(platform.claude.com)에서 발급받아요. 이 브라우저에만 저장되고, 분석할 때 Anthropic API로만 보내요. 공용 컴퓨터에서는 쓰지 마세요.">
        <div className="flex items-center">
          <input
            type={show ? 'text' : 'password'}
            value={s.apiKey}
            onChange={(e) => setS({ ...s, apiKey: e.target.value.trim() })}
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

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">모델</span>
        <select value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })} className="rounded-[8px] border border-line-strong bg-bg px-2.5 py-2 text-[14px] outline-none focus:border-accent">
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
