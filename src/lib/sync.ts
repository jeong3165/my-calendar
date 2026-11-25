import { format } from 'date-fns'
import { create } from 'zustand'
import { db } from '../db'
import { mergeData, signature, type SyncFile } from './merge'

/* ───────── 설정 (이 브라우저에만 저장) ───────── */
export type SyncSettings = { repo: string; path: string; token: string; enabled: boolean }
const KEY = 'my-calendar.sync-settings'
const DEFAULTS: SyncSettings = { repo: '', path: 'calendar.json', token: '', enabled: false }

export function loadSync(): SyncSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}
export function saveSync(s: SyncSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}
export const ready = (s: SyncSettings) => s.enabled && !!s.token && /^[\w.-]+\/[\w.-]+$/.test(s.repo)

/* ───────── 상태 (사이드바 표시용) ───────── */
export type SyncState = {
  status: 'off' | 'idle' | 'syncing' | 'error' | 'offline'
  lastSync: string | null
  error: string | null
  lastSig: string | null
}
export const useSync = create<SyncState>(() => ({
  status: ready(loadSync()) ? 'idle' : 'off',
  lastSync: null,
  error: null,
  lastSig: null,
}))

/* ───────── GitHub REST API ───────── */
export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function gh(s: Pick<SyncSettings, 'token'>, path: string, init: RequestInit = {}) {
  let res: Response
  try {
    res = await fetch(`https://api.github.com${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${s.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    })
  } catch {
    throw new GitHubError(0, navigator.onLine ? 'GitHub에 연결하지 못했어요. 회사 네트워크에서 api.github.com 이 막혀 있을 수 있어요.' : '인터넷에 연결되어 있지 않아요.')
  }
  if (res.ok) return res
  const body = await res.json().catch(() => ({}) as { message?: string })
  const msg: string = body?.message ?? ''
  const raw = msg ? ` (GitHub: ${msg})` : ''
  if (res.status === 401) throw new GitHubError(401, `토큰이 올바르지 않거나 만료됐어요. 새 토큰을 넣어 주세요.${raw}`)
  if (res.status === 403 && /rate limit/i.test(msg)) throw new GitHubError(403, `GitHub 요청 한도를 넘었어요. 잠시 후 다시 시도해요.${raw}`)
  if (res.status === 403)
    throw new GitHubError(
      403,
      init.method && init.method !== 'GET'
        ? `토큰에 쓰기 권한이 없어요. GitHub → Settings → Developer settings → Fine-grained tokens → 이 토큰 → Edit 에서 Repository permissions 의 Contents 를 "Read and write" 로 바꿔 주세요. 토큰 값은 그대로라 다시 넣을 필요 없어요.${raw}`
        : `토큰에 이 저장소를 읽을 권한이 없어요. 토큰의 Repository access 에 데이터 저장소를 고르고, Contents 를 "Read and write" 로 주세요.${raw}`,
    )
  throw new GitHubError(res.status, `${msg || 'GitHub 오류'} (${res.status})`)
}

export const enc = (path: string) => path.split('/').map(encodeURIComponent).join('/')

export function b64encode(str: string) {
  const bytes = new TextEncoder().encode(str)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
export function b64decode(b64: string) {
  const bin = atob(b64.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

/** 연결 테스트: 저장소가 있고, 비공개이고, 쓸 수 있는지 */
export async function testConnection(s: SyncSettings): Promise<string> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(s.repo)) throw new Error('저장소는 "아이디/저장소이름" 형식으로 적어 주세요.')
  if (!s.token) throw new Error('토큰을 넣어 주세요.')
  let repo: { private: boolean; permissions?: { push?: boolean }; full_name: string }
  try {
    repo = await (await gh(s, `/repos/${s.repo}`)).json()
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) throw new Error('저장소를 찾을 수 없어요. 이름을 확인하고, 토큰에 이 저장소 접근 권한을 줬는지 확인해 주세요.')
    throw e
  }
  if (!repo.private) throw new Error('공개 저장소에는 일정을 저장할 수 없어요. 비공개(Private) 저장소를 써 주세요.')
  if (repo.permissions && repo.permissions.push === false) throw new Error('이 토큰으로는 저장소에 쓸 수 없어요. Contents 권한을 "Read and write" 로 주세요.')
  const remote = await pull(s)
  // 쓰기 권한 확인: 어디에도 연결되지 않는 빈 Git 객체를 하나 만들어 본다 (저장소 내용·기록에는 영향 없음)
  try {
    await gh(s, `/repos/${s.repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: '', encoding: 'utf-8' }) })
  } catch (e) {
    if (!(e instanceof GitHubError && e.status === 409)) throw e // 409 = 아직 빈 저장소 → 첫 동기화 때 확인
  }
  return remote ? `연결됐어요. 저장된 항목 ${remote.data.items.length}개가 있어요.` : '연결됐어요. 아직 저장된 데이터가 없어서 첫 동기화 때 파일을 만들어요.'
}

async function pull(s: SyncSettings): Promise<{ sha: string; data: SyncFile } | null> {
  let res: Response
  try {
    res = await gh(s, `/repos/${s.repo}/contents/${enc(s.path)}`)
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return null // 파일 없음 / 빈 저장소
    throw e
  }
  const meta: { sha: string; content?: string; encoding?: string } = await res.json()
  let text: string
  if (meta.encoding === 'base64' && meta.content) text = b64decode(meta.content)
  else {
    // 1MB 넘는 파일은 blob API 로 받는다
    const blob: { content: string } = await (await gh(s, `/repos/${s.repo}/git/blobs/${meta.sha}`)).json()
    text = b64decode(blob.content)
  }
  const data = JSON.parse(text) as SyncFile
  if (data?.app !== 'my-notion-calendar' || !Array.isArray(data.items)) throw new Error(`${s.path} 는 이 앱의 동기화 파일이 아니에요. 다른 파일 이름을 써 주세요.`)
  data.deleted ??= {}
  return { sha: meta.sha, data }
}

async function push(s: SyncSettings, data: SyncFile, sha: string | null) {
  await gh(s, `/repos/${s.repo}/contents/${enc(s.path)}`, {
    method: 'PUT',
    body: JSON.stringify({
      message: `동기화: ${format(new Date(), 'yyyy-MM-dd HH:mm')} · ${deviceLabel()} (${data.items.length}개)`,
      content: b64encode(JSON.stringify(data, null, 1)),
      ...(sha ? { sha } : {}),
    }),
  })
}

function deviceLabel() {
  const ua = navigator.userAgent
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Linux'
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '브라우저'
  return `${os} ${br}`
}

/* ───────── 동기화 한 번 ───────── */
let running: Promise<void> | null = null
let again = false

export function syncNow(): Promise<void> {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        await syncOnce()
      } while (again)
    } finally {
      running = null
    }
  })()
  return running
}

async function syncOnce() {
  const s = loadSync()
  if (!ready(s)) {
    useSync.setState({ status: 'off', error: null })
    return
  }
  if (!navigator.onLine) {
    useSync.setState({ status: 'offline' })
    return
  }
  useSync.setState({ status: 'syncing' })
  try {
    for (let attempt = 0; ; attempt++) {
      const remote = await pull(s)
      const [items, tombstones, journal, sessions] = await Promise.all([db.items.toArray(), db.tombstones.toArray(), db.journal.toArray(), db.sessions.toArray()])
      const merged = mergeData({ items, tombstones, journal, sessions }, remote?.data ?? null)

      // 1) 이 기기에 반영
      const localById = new Map(items.map((i) => [i.id, i]))
      const mergedIds = new Set(merged.items.map((i) => i.id))
      const toPut = merged.items.filter((m) => localById.get(m.id)?.updatedAt !== m.updatedAt)
      const toDelete = items.filter((i) => !mergedIds.has(i.id)).map((i) => i.id)
      const tombs = Object.entries(merged.deleted).map(([id, deletedAt]) => ({ id, deletedAt }))
      const localJ = new Map(journal.map((j) => [j.date, j.updatedAt]))
      const jPut = merged.journal.filter((j) => localJ.get(j.date) !== j.updatedAt)
      const localS = new Map(sessions.map((x) => [x.id, x.updatedAt]))
      const sKeep = new Set(merged.sessions.map((x) => x.id))
      const sPut = merged.sessions.filter((x) => localS.get(x.id) !== x.updatedAt)
      const sDel = sessions.filter((x) => !sKeep.has(x.id)).map((x) => x.id)
      if (toPut.length || toDelete.length || jPut.length || sPut.length || sDel.length || signature([], tombs) !== signature([], tombstones)) {
        await db.transaction('rw', [db.items, db.tombstones, db.journal, db.sessions], async () => {
          if (jPut.length) await db.journal.bulkPut(jPut)
          if (sPut.length) await db.sessions.bulkPut(sPut)
          if (sDel.length) await db.sessions.bulkDelete(sDel)
          if (toPut.length) await db.items.bulkPut(toPut)
          if (toDelete.length) await db.items.bulkDelete(toDelete)
          await db.tombstones.clear()
          if (tombs.length) await db.tombstones.bulkPut(tombs)
        })
      }

      // 2) 저장소에 반영 (바뀐 게 있을 때만 커밋)
      const sig = signature(merged.items, merged.deleted, merged.journal, merged.sessions)
      const remoteSig = remote ? signature(remote.data.items, remote.data.deleted, remote.data.journal ?? [], remote.data.sessions ?? []) : null
      if (sig !== remoteSig) {
        try {
          await push(s, { app: 'my-notion-calendar', version: 1, updatedAt: new Date().toISOString(), ...merged }, remote?.sha ?? null)
        } catch (e) {
          // 그 사이 다른 기기가 먼저 저장함 → 다시 받아서 합치기
          if (e instanceof GitHubError && (e.status === 409 || e.status === 422) && attempt < 3) continue
          throw e
        }
      }
      useSync.setState({ status: 'idle', error: null, lastSync: new Date().toISOString(), lastSig: sig })
      return
    }
  } catch (e) {
    useSync.setState({ status: navigator.onLine ? 'error' : 'offline', error: (e as Error).message })
  }
}

/** 현재 로컬 데이터 지문 (바뀌었는지 확인용) */
export async function localSignature() {
  const [items, tombstones, journal, sessions] = await Promise.all([db.items.toArray(), db.tombstones.toArray(), db.journal.toArray(), db.sessions.toArray()])
  return signature(items, tombstones, journal, sessions)
}
