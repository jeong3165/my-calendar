import { useMemo } from 'react'
import { create } from 'zustand'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, useItems } from '../db'
import type { Item, NotionColor, Subscription } from '../types'
import { parseICS } from './ics'
import { b64decode, b64encode, enc, gh, GitHubError, loadSync, ready } from './sync'

/* ───────── 구독 목록 (이 브라우저 + GitHub 데이터 저장소에 함께 저장) ───────── */
const KEY = 'my-calendar.subscriptions'
type Stored = { list: Subscription[]; updatedAt: string }

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore */
  }
  return { list: [], updatedAt: '' }
}
function saveStored(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

export type SubStatus = { state: 'loading' | 'ok' | 'error'; method?: 'direct' | 'github'; error?: string; count?: number; fetchedAt?: string; unsupported?: number }

type SubsState = {
  list: Subscription[]
  status: Record<string, SubStatus>
  autoFetch: 'unknown' | 'on' | 'off'
}
export const useSubs = create<SubsState>(() => ({ list: loadStored().list, status: {}, autoFetch: 'unknown' }))

export const newSubId = () => Math.random().toString(36).slice(2, 10)

export async function setSubscriptions(list: Subscription[]) {
  const stored = { list, updatedAt: new Date().toISOString() }
  saveStored(stored)
  useSubs.setState({ list })
  // 지운 구독의 캐시 정리
  const ids = new Set(list.map((s) => s.id))
  const cached = await db.subcache.toCollection().primaryKeys()
  await db.subcache.bulkDelete(cached.filter((id) => !ids.has(id as string)))
  await pushSubscriptionsFile(stored).catch(() => {})
}

/* ───────── 화면에 보일 구독 일정 ───────── */
const EMPTY: Item[] = []
export function useSubscribedItems(): Item[] {
  const list = useSubs((s) => s.list)
  const on = list.filter((s) => s.enabled).map((s) => s.id)
  const key = on.join(',')
  return (
    useLiveQuery(async () => {
      if (!on.length) return EMPTY
      const rows = await db.subcache.bulkGet(on)
      const byId = new Map(list.map((s) => [s.id, s]))
      // 색·이름을 바꾸면 다시 받지 않아도 바로 반영
      return rows.flatMap((r) => {
        const s = r && byId.get(r.id)
        return r && s ? r.items.map((it) => ({ ...it, color: s.color, readonly: { subId: s.id, name: s.name } })) : []
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, list]) ?? EMPTY
  )
}

/** 캘린더 화면용: 내 항목 + 구독 일정 */
export function useCalendarItems(): Item[] {
  const own = useItems()
  const sub = useSubscribedItems()
  return useMemo(() => (sub.length ? [...own, ...sub] : own), [own, sub])
}

/* ───────── 가져오기 ───────── */
const webcal = (u: string) => u.trim().replace(/^webcals?:\/\//i, 'https://')

async function fetchDirect(url: string): Promise<string> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(webcal(url), { signal: ctrl.signal, cache: 'no-store' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(t)
  }
}

/** GitHub Actions 가 데이터 저장소에 받아 둔 파일 읽기 */
async function fetchFromGitHub(id: string): Promise<{ text: string } | null> {
  const s = loadSync()
  if (!ready(s)) return null
  try {
    const meta: { sha: string; content?: string; encoding?: string } = await (await gh(s, `/repos/${s.repo}/contents/${enc(`subscriptions/${id}.ics`)}`)).json()
    if (meta.encoding === 'base64' && meta.content) return { text: b64decode(meta.content) }
    const blob: { content: string } = await (await gh(s, `/repos/${s.repo}/git/blobs/${meta.sha}`)).json()
    return { text: b64decode(blob.content) }
  } catch (e) {
    if (e instanceof GitHubError && e.status === 404) return null
    throw e
  }
}

function setStatus(id: string, st: SubStatus) {
  useSubs.setState((s) => ({ status: { ...s.status, [id]: st } }))
}

export async function refreshOne(sub: Subscription): Promise<void> {
  setStatus(sub.id, { ...useSubs.getState().status[sub.id], state: 'loading' })
  let text: string | null = null
  let method: SubStatus['method']
  let directErr = ''
  try {
    text = await fetchDirect(sub.url)
    method = 'direct'
  } catch (e) {
    directErr = (e as Error).message
  }
  if (!text || !/BEGIN:VCALENDAR/.test(text)) {
    try {
      const g = await fetchFromGitHub(sub.id)
      if (g) {
        text = g.text
        method = 'github'
      }
    } catch (e) {
      directErr = (e as Error).message
    }
  }
  if (!text) {
    const syncOn = ready(loadSync())
    setStatus(sub.id, {
      state: 'error',
      error: syncOn
        ? '아직 가져온 파일이 없어요. 아래 "GitHub 자동 가져오기"를 켜면 몇 분 안에 받아 와요.'
        : `이 주소는 브라우저에서 바로 읽을 수 없어요(${directErr || '차단됨'}). GitHub 동기화를 켜고 "자동 가져오기"를 설정해 주세요.`,
    })
    return
  }
  try {
    const parsed = parseICS(text, sub)
    const fetchedAt = new Date().toISOString()
    await db.subcache.put({ id: sub.id, fetchedAt, method: method!, items: parsed.items })
    setStatus(sub.id, { state: 'ok', method, count: parsed.items.length, fetchedAt, unsupported: parsed.unsupported })
  } catch (e) {
    setStatus(sub.id, { state: 'error', error: (e as Error).message })
  }
}

let refreshing = false
export async function refreshAll() {
  if (refreshing) return
  refreshing = true
  try {
    await pullSubscriptionsFile().catch(() => {})
    const list = useSubs.getState().list.filter((s) => s.enabled)
    await Promise.all(list.map((s) => refreshOne(s)))
  } finally {
    refreshing = false
  }
}

/** 캐시에 남아 있는 마지막 상태로 표시 (앱을 막 열었을 때) */
export async function loadCachedStatus() {
  const rows = await db.subcache.toArray()
  const status: Record<string, SubStatus> = {}
  for (const r of rows) status[r.id] = { state: 'ok', method: r.method, count: r.items.length, fetchedAt: r.fetchedAt }
  useSubs.setState((s) => ({ status: { ...status, ...s.status } }))
}

/* ───────── GitHub 데이터 저장소 연동 ───────── */
const LIST_PATH = 'subscriptions.json'
const WF_PATH = '.github/workflows/fetch-calendars.yml'

async function getFile(path: string): Promise<{ sha: string; text: string } | null> {
  const s = loadSync()
  try {
    const meta: { sha: string; content: string } = await (await gh(s, `/repos/${s.repo}/contents/${enc(path)}`)).json()
    return { sha: meta.sha, text: b64decode(meta.content) }
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return null
    throw e
  }
}

async function putFile(path: string, text: string, message: string) {
  const s = loadSync()
  const cur = await getFile(path)
  if (cur?.text === text) return
  await gh(s, `/repos/${s.repo}/contents/${enc(path)}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: b64encode(text), ...(cur ? { sha: cur.sha } : {}) }),
  })
}

/** 구독 목록을 저장소에 올린다 → 다른 기기와 자동 가져오기(Actions)가 함께 쓴다 */
async function pushSubscriptionsFile(stored: Stored) {
  if (!ready(loadSync())) return
  await putFile(LIST_PATH, JSON.stringify(stored, null, 2) + '\n', `구독 캘린더 목록 갱신 (${stored.list.length}개)`)
}

/** 저장소의 목록이 더 최신이면 가져온다 */
export async function pullSubscriptionsFile() {
  if (!ready(loadSync())) return
  const f = await getFile(LIST_PATH)
  const local = loadStored()
  if (!f) {
    // 저장소에 아직 목록이 없음 → 이 기기의 목록을 올린다
    if (local.list.length) await pushSubscriptionsFile(local)
    return
  }
  const remote = JSON.parse(f.text) as Stored
  if (remote.updatedAt > local.updatedAt && Array.isArray(remote.list)) {
    saveStored(remote)
    useSubs.setState({ list: remote.list })
  } else if (local.updatedAt > remote.updatedAt) await pushSubscriptionsFile(local)
}

export async function checkAutoFetch() {
  if (!ready(loadSync())) return useSubs.setState({ autoFetch: 'off' })
  try {
    useSubs.setState({ autoFetch: (await getFile(WF_PATH)) ? 'on' : 'off' })
  } catch {
    useSubs.setState({ autoFetch: 'unknown' })
  }
}

/** 데이터 저장소에 '정기적으로 캘린더 받아 오기' 작업(GitHub Actions)을 만든다 */
export async function setupAutoFetch(): Promise<void> {
  const s = loadSync()
  if (!ready(s)) throw new Error('먼저 GitHub 동기화를 켜 주세요.')
  await pushSubscriptionsFile(loadStored())
  try {
    await putFile(WF_PATH, WORKFLOW, '구독 캘린더 자동 가져오기 설정')
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 403 || e.status === 404))
      throw new Error(
        '토큰에 "Workflows" 권한이 없어요. GitHub → Settings → Developer settings → Fine-grained tokens → 이 토큰 → Edit → Repository permissions 에서 "Workflows"를 "Read and write"로 바꾼 뒤 다시 눌러 주세요.',
      )
    throw e
  }
  useSubs.setState({ autoFetch: 'on' })
}

export const SUB_COLORS: NotionColor[] = ['purple', 'orange', 'green', 'pink', 'brown', 'yellow', 'red', 'gray', 'blue']

/**
 * 데이터 저장소에서 2시간마다(그리고 목록이 바뀔 때) 실행.
 * 비공개 캘린더 주소는 이 비공개 저장소 밖으로 나가지 않는다.
 */
export const WORKFLOW = `# 내 캘린더: 구독한 캘린더(.ics)를 정기적으로 받아 subscriptions/ 폴더에 저장
name: Fetch subscribed calendars

on:
  schedule:
    - cron: '23 */2 * * *'
  push:
    paths: ['subscriptions.json']
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: fetch-calendars
  cancel-in-progress: false

jobs:
  fetch:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - name: Download calendars
        run: |
          mkdir -p subscriptions
          keep=""
          for row in $(jq -r '.list[] | select(.enabled != false) | @base64' subscriptions.json); do
            id=$(echo "$row" | base64 -d | jq -r .id)
            url=$(echo "$row" | base64 -d | jq -r .url | sed -E 's#^webcals?://#https://#')
            keep="$keep $id.ics"
            if curl -fsSL --max-time 60 -A "my-calendar-fetch" "$url" -o "/tmp/$id.ics" && grep -q "BEGIN:VCALENDAR" "/tmp/$id.ics"; then
              # 받을 때마다 바뀌는 DTSTAMP 줄은 지워서 불필요한 커밋을 막는다
              tr -d '\\r' < "/tmp/$id.ics" | grep -v '^DTSTAMP' > "subscriptions/$id.ics"
              echo "ok: $id"
            else
              echo "::warning::failed to fetch $id"
            fi
          done
          # 목록에서 지운 구독 파일 정리
          for f in subscriptions/*.ics; do
            [ -e "$f" ] || continue
            case " $keep " in *" $(basename "$f") "*) ;; *) rm -f "$f" ;; esac
          done
      - name: Commit
        run: |
          git config user.name "calendar-bot"
          git config user.email "calendar-bot@users.noreply.github.com"
          git add -A subscriptions
          if git diff --cached --quiet; then echo "no changes"; exit 0; fi
          git commit -m "구독 캘린더 갱신"
          for i in 1 2 3; do git pull --rebase && git push && break; sleep 5; done
`
