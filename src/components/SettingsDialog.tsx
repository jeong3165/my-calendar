import { useState } from 'react'
import { useUI } from '../store'
import { MODELS, loadSettings, saveSettings } from '../lib/importFiles'
import { Icon } from './ui'

export function SettingsDialog() {
  const { setSettings, showToast } = useUI()
  const [s, setS] = useState(loadSettings)
  const [show, setShow] = useState(false)

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-black/30 px-4 pt-[10vh]" onMouseDown={() => setSettings(false)}>
      <div role="dialog" aria-label="AI 설정" onMouseDown={(e) => e.stopPropagation()} className="shadow-pop w-full max-w-[480px] rounded-[12px] bg-popover">
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Icon name="settings" size={17} className="text-fg2" />
          <h2 className="flex-1 text-[16px] font-semibold">AI 설정</h2>
          <button onClick={() => setSettings(false)} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="flex flex-col gap-4 p-5">
          <label className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">Claude API 키</span>
            <div className="flex items-center rounded-[8px] border border-line-strong focus-within:border-accent">
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
            <span className="text-[12px] leading-relaxed text-fg2">
              Claude Console(platform.claude.com)에서 발급받을 수 있어요. 키는 <b>이 브라우저에만</b> 저장되고, 분석할 때 Anthropic API로만 보내요. 공용 컴퓨터에서는 쓰지 마세요.
            </span>
          </label>

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
      </div>
    </div>
  )
}
