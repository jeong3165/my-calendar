import { useEffect } from 'react'
import { loadCachedStatus, refreshAll, useSubs } from '../lib/subs'
import { loadSync, ready } from '../lib/sync'

/** 구독 캘린더: 앱을 열 때, 30분마다, 창으로 돌아왔을 때(10분 이상 지났으면) 다시 읽기 */
export function SubsAgent() {
  useEffect(() => {
    let last = 0
    const run = () => {
      // 구독이 없고 GitHub 동기화도 꺼져 있으면 할 일이 없음 (동기화가 켜져 있으면 다른 기기의 목록을 받아 온다)
      if (!useSubs.getState().list.length && !ready(loadSync())) return
      last = Date.now()
      void refreshAll()
    }
    void loadCachedStatus().then(run)
    const t = setInterval(run, 30 * 60_000)
    const onFocus = () => Date.now() - last > 10 * 60_000 && run()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [])
  return null
}
