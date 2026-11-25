import { useEffect } from 'react'
import { addDays } from 'date-fns'
import { db } from '../db'
import { useUI } from '../store'
import { expandItems } from '../lib/recur'
import { parseYmd } from '../lib/date'
import { loadFired, loadNotify, notifyBody, remindAt, saveFired, showSystemNotification } from '../lib/notify'
import { buildBriefing, isDue, loadBriefing, markShown, summaryLine } from '../lib/briefing'
import { useSubs } from '../lib/subs'

const LATE_OK = 15 * 60000 // 15분까지 늦은 알림은 보낸다 (앱을 늦게 연 경우)

/**
 * 알림 스케줄러: 앱(탭 또는 설치한 앱 창)이 열려 있는 동안 20초마다 확인
 */
export function NotificationAgent() {
  useEffect(() => {
    let stop = false
    /** 아침 브리핑: 정한 시각이 지나고 오늘 처음이면 알림 + 브리핑 창 */
    async function briefing() {
      const st = loadBriefing()
      if (stop || !isDue(st)) return
      markShown()
      const items = await db.items.toArray()
      const subs = useSubs.getState().list.filter((s) => s.enabled)
      const rows = subs.length ? await db.subcache.bulkGet(subs.map((s) => s.id)) : []
      const sub = rows.flatMap((r) => (r ? r.items.map((it) => ({ ...it, readonly: { subId: r.id, name: subs.find((s) => s.id === r.id)?.name ?? '' } })) : []))
      const b = buildBriefing([...items, ...sub])
      // 앱을 보고 있지 않을 때만 시스템 알림 (보고 있으면 창이 바로 뜨니까)
      if (document.visibilityState !== 'visible') await showSystemNotification(`☀️ 아침 브리핑 · ${b.label}`, summaryLine(b), { id: '__briefing' }, 'briefing')
      useUI.setState({ briefingOpen: true })
    }

    async function tick() {
      await briefing()
      if (stop || !loadNotify().enabled) return
      const now = Date.now()
      const items = await db.items.toArray()
      const fired = loadFired()
      let changed = false
      for (const it of expandItems(items, addDays(new Date(now), -2), addDays(new Date(now), 3))) {
        if (!it.remind?.length || (it.type === 'task' && it.done)) continue
        for (const m of it.remind) {
          const at = remindAt(it, m)?.getTime()
          if (at === undefined || at > now || at < now - LATE_OK) continue
          const key = `${it.id}|${it.start ?? it.due}|${m}`
          if (fired[key]) continue
          fired[key] = now
          changed = true
          const title = it.title || '제목 없음'
          const body = notifyBody(it)
          await showSystemNotification(title, body, { id: it.id, date: it.start ?? it.due }, key)
          useUI.getState().showToast(`🔔 ${title} · ${body}`)
        }
      }
      if (changed) saveFired(fired)
    }

    void tick()
    const t = setInterval(tick, 20_000)
    const onVis = () => document.visibilityState === 'visible' && void tick()
    document.addEventListener('visibilitychange', onVis)

    // 알림을 누르면 해당 항목 열기
    const openItem = (d?: { id: string; date?: string }) => {
      if (!d?.id) return
      const ui = useUI.getState()
      if (d.id === '__briefing') return useUI.setState({ briefingOpen: true })
      if (d.date) ui.setDate(d.date.length === 10 ? parseYmd(d.date) : new Date(d.date))
      ui.open(d.id)
    }
    const onCustom = (e: Event) => openItem((e as CustomEvent).detail)
    const onSW = (e: MessageEvent) => e.data?.type === 'open-item' && openItem(e.data.data)
    window.addEventListener('open-item', onCustom)
    navigator.serviceWorker?.addEventListener('message', onSW)
    return () => {
      stop = true
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('open-item', onCustom)
      navigator.serviceWorker?.removeEventListener('message', onSW)
    }
  }, [])
  return null
}
