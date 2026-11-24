import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { localSignature, syncNow, useSync } from '../lib/sync'

/**
 * 자동 동기화
 * - 앱을 열 때, 창으로 돌아올 때, 인터넷이 다시 연결될 때, 5분마다
 * - 이 기기에서 무언가 바뀌면 3초 뒤 (연속 입력은 한 번으로 묶음)
 */
export function SyncAgent() {
  const sig = useLiveQuery(localSignature, [])
  const lastSig = useSync((s) => s.lastSig)
  const status = useSync((s) => s.status)

  useEffect(() => {
    void syncNow()
    const onFocus = () => void syncNow()
    const t = setInterval(() => document.visibilityState === 'visible' && void syncNow(), 5 * 60_000)
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onFocus)
    }
  }, [])

  useEffect(() => {
    if (status === 'off' || sig === undefined || lastSig === null || sig === lastSig) return
    const t = setTimeout(() => void syncNow(), 3000)
    return () => clearTimeout(t)
  }, [sig, lastSig, status])

  // 저장 안 된 변경이 있으면 창을 닫을 때 알려 준다
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      const s = useSync.getState()
      if (s.status !== 'off' && s.lastSig && sig && sig !== s.lastSig) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBefore)
    return () => window.removeEventListener('beforeunload', onBefore)
  }, [sig])

  return null
}
