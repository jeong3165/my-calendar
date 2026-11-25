import { useEffect, useRef, useState } from 'react'
import { format, isToday } from 'date-fns'
import { ko } from 'date-fns/locale'
import type Anthropic from '@anthropic-ai/sdk'
import { useUI } from '../store'
import type { Chat } from '../db'
import { deleteChat, newChat, NOW_TAG, undoAction, useChat, useChats } from '../lib/chat'
import { fileToSource, loadSettings, type ImportSource } from '../lib/importFiles'
import type { UserPart } from '../lib/chatAgent'
import { Icon } from './ui'
import { Markdown } from './Markdown'

type Block = Anthropic.Beta.BetaContentBlock
type Param = Anthropic.Beta.BetaContentBlockParam
type Msg = { role: 'user' | 'assistant'; content: string | Param[] }

const EXAMPLES = [
  '오늘이랑 내일 일정 정리해줘',
  '이번 주말 서울 날씨 알려줘',
  '다음 주 금요일 저녁 7시에 친구랑 저녁 약속 넣어줘',
  '요즘 화제인 IT 뉴스 3가지만 요약해줘',
]

const LAST = 'my-calendar.chat-last'
const readLast = () => {
  try {
    return localStorage.getItem(LAST)
  } catch {
    return null
  }
}
const writeLast = (id: string) => {
  try {
    localStorage.setItem(LAST, id)
  } catch {
    /* ignore */
  }
}

/** AI 채팅: 웹 검색 + 내 캘린더까지 다루는 범용 챗봇 */
export function ChatView() {
  const { showToast, setSettings, isMobile, screen } = useUI()
  const chats = useChats()
  const [chatId, setChatId] = useState<string | null>(readLast)
  const chat = useChat(chatId)
  const [listOpen, setListOpen] = useState(false)
  const [input, setInput] = useState('')
  const [files, setFiles] = useState<ImportSource[]>([])
  const [busy, setBusy] = useState(false)
  const [live, setLive] = useState<Block[] | null>(null)
  const [status, setStatus] = useState<string>()
  const abort = useRef<AbortController | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const fileInput = useRef<HTMLInputElement>(null)
  const ta = useRef<HTMLTextAreaElement>(null)
  const hasKey = !!loadSettings().apiKey

  // 고른 대화가 지워졌으면 가장 최근 대화로
  useEffect(() => {
    if (chatId && chat === undefined && chats.length && !chats.some((c) => c.id === chatId)) setChatId(chats[0].id)
  }, [chat, chatId, chats])
  useEffect(() => {
    if (chatId) writeLast(chatId)
  }, [chatId])

  // 새 글이 오면 아래로 (사용자가 위로 올려 읽는 중이면 그대로)
  useEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat?.messages.length, live])

  // 입력칸 높이 자동 조절
  useEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [input])

  async function addFiles(list: FileList | File[]) {
    for (const f of Array.from(list)) {
      try {
        const s = await fileToSource(f)
        setFiles((x) => [...x, s].slice(0, 5))
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e))
      }
    }
  }

  async function send(textArg?: string) {
    const text = (textArg ?? input).trim()
    if ((!text && !files.length) || busy) return
    const s = loadSettings()
    if (!s.apiKey) return setSettings(true, 'ai')
    let id = chatId
    if (!id || !chat) {
      const c = await newChat()
      id = c.id
      setChatId(id)
    }
    const parts: UserPart[] = [
      ...files.map((f): UserPart => (f.kind === 'image' ? { kind: 'image', mediaType: f.mediaType, data: f.data } : f.kind === 'pdf' ? { kind: 'pdf', data: f.data, name: f.name } : { kind: 'text', text: `[${f.name}]\n${f.text}` })),
      ...(text ? [{ kind: 'text' as const, text }] : []),
    ]
    const keepFiles = files
    setInput('')
    setFiles([])
    setBusy(true)
    setStatus(undefined)
    stick.current = true
    const ctrl = new AbortController()
    abort.current = ctrl
    let frame = 0
    let pending: Block[] | null = null
    try {
      const { sendTurn } = await import('../lib/chatAgent')
      const r = await sendTurn(
        id,
        parts,
        s,
        (blocks, st) => {
          // 글자 하나마다 다시 그리지 않도록 한 프레임에 한 번만
          pending = blocks
          setStatus(st)
          if (!blocks) {
            cancelAnimationFrame(frame)
            setLive(null)
            return
          }
          if (!frame)
            frame = requestAnimationFrame(() => {
              frame = 0
              setLive(pending)
            })
        },
        ctrl.signal,
      )
      if (!r.ok) {
        showToast(r.message)
        if (r.restore !== undefined) {
          setInput(r.restore)
          setFiles(keepFiles)
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e))
    } finally {
      cancelAnimationFrame(frame)
      setLive(null)
      setBusy(false)
      abort.current = null
    }
  }

  async function startNew() {
    if (busy) return
    if (chat && chat.messages.length === 0) return setListOpen(false)
    const c = await newChat()
    setChatId(c.id)
    setListOpen(false)
    setTimeout(() => ta.current?.focus(), 0)
  }

  const messages = (chat?.messages ?? []) as Msg[]
  const empty = messages.length === 0 && !live
  const showSide = screen === 'desktop' || (!isMobile && screen === 'tablet')

  const list = (
    <ChatList
      chats={chats}
      current={chatId}
      onPick={(id) => {
        if (busy) return
        setChatId(id)
        setListOpen(false)
      }}
      onNew={startNew}
      onDelete={async (id) => {
        if (!confirm('이 대화를 지울까요? 캘린더에 넣은 항목은 그대로 남아요.')) return
        await deleteChat(id)
        if (id === chatId) setChatId(null)
      }}
    />
  )

  return (
    <div className="flex min-h-0 flex-1">
      {showSide && <aside className="flex w-60 shrink-0 flex-col border-r border-line">{list}</aside>}

      <div className="relative flex min-w-0 flex-1 flex-col">
        {!showSide && (
          <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
            <button onClick={() => setListOpen(true)} className="flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[6px] px-2 text-left text-[14px] hover:bg-hover">
              <Icon name="list" size={15} className="shrink-0 text-fg3" />
              <span className="truncate">{chat?.title ?? '새 대화'}</span>
              <span className="shrink-0 text-[12px] text-fg3">· 대화 {chats.length}개</span>
            </button>
            <button onClick={startNew} className="flex h-8 shrink-0 items-center gap-1 rounded-[6px] px-2 text-[13px] text-fg2 hover:bg-hover">
              <Icon name="plus" size={14} /> 새 대화
            </button>
          </div>
        )}
        {!showSide && listOpen && (
          <>
            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setListOpen(false)} />
            <div className="shadow-pop fixed inset-x-0 bottom-0 z-50 flex max-h-[75vh] flex-col rounded-t-[16px] bg-popover pb-[env(safe-area-inset-bottom)]">
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong" />
              {list}
            </div>
          </>
        )}

        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
          }}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto flex max-w-[760px] flex-col gap-4 px-4 py-5 max-md:px-3 max-md:py-3">
            {empty ? (
              <Welcome hasKey={hasKey} onPick={(t) => (t.endsWith(': ') ? (setInput(t), ta.current?.focus()) : void send(t))} onKey={() => setSettings(true, 'ai')} />
            ) : (
              messages.map((m, i) => <MessageView key={i} m={m} chat={chat!} />)
            )}
            {live && <AssistantBlocks blocks={live as unknown as Param[]} chat={chat} live />}
            {busy && (!live || !live.some((b) => b.type === 'text' && b.text)) && (
              <div className="flex items-center gap-2 text-[13px] text-fg3">
                <span className="flex gap-1">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg3 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg3 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-fg3" />
                </span>
                {status ?? '생각 중…'}
              </div>
            )}
          </div>
        </div>

        {/* 입력 */}
        <div className="border-t border-line px-3 pt-2 pb-3 max-md:pb-2">
          <div className="mx-auto max-w-[760px]">
            {files.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {files.map((f, i) => (
                  <span key={i} className="flex items-center gap-1 rounded-[6px] bg-hover py-0.5 pr-1 pl-1 text-[12px]">
                    {f.kind === 'image' ? <img src={f.preview} alt="" className="h-7 w-7 rounded object-cover" /> : <Icon name="file" size={14} className="text-fg3" />}
                    <span className="max-w-[140px] truncate">{f.name}</span>
                    <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="grid h-5 w-5 place-items-center rounded text-fg3 hover:bg-active" aria-label="첨부 빼기">
                      <Icon name="x" size={11} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-1.5 rounded-[12px] border border-line-strong bg-bg px-2 py-1.5 focus-within:border-accent">
              <button onClick={() => fileInput.current?.click()} className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] text-fg3 hover:bg-hover" aria-label="사진·파일 첨부" title="사진·PDF·텍스트 첨부 (붙여넣기도 돼요)">
                <Icon name="image" size={17} />
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                accept="image/*,application/pdf,.txt,.md,.csv,.ics"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) void addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <textarea
                ref={ta}
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !isMobile) {
                    e.preventDefault()
                    void send()
                  }
                }}
                onPaste={(e) => {
                  const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'))
                  if (imgs.length) {
                    e.preventDefault()
                    void addFiles(imgs)
                  }
                }}
                placeholder={isMobile ? '무엇이든 물어보세요' : '무엇이든 물어보세요 · 웹 검색, 내 일정 확인·추가 (Enter 보내기, Shift+Enter 줄바꿈)'}
                className="max-h-[180px] min-h-8 flex-1 resize-none bg-transparent py-1 text-[14.5px] leading-[1.5] outline-none"
              />
              {busy ? (
                <button onClick={() => abort.current?.abort()} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fg text-bg" aria-label="멈추기" title="멈추기">
                  <span className="h-2.5 w-2.5 rounded-[2px] bg-bg" />
                </button>
              ) : (
                <button onClick={() => void send()} disabled={!input.trim() && !files.length} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-white disabled:opacity-35" aria-label="보내기">
                  <Icon name="send" size={15} />
                </button>
              )}
            </div>
            {chat?.usage && chat.usage.output > 0 && (
              <p className="mt-1 text-right text-[11px] text-fg3" title="대화가 길어질수록 이전 내용을 다시 보내므로 비용이 늘어요. 주제가 바뀌면 새 대화를 시작하세요.">
                이 대화: 입력 {fmtTok(chat.usage.input + chat.usage.cacheRead)} · 출력 {fmtTok(chat.usage.output)} 토큰{chat.usage.searches ? ` · 웹 검색 ${chat.usage.searches}회` : ''}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

function Welcome({ hasKey, onPick, onKey }: { hasKey: boolean; onPick: (t: string) => void; onKey: () => void }) {
  return (
    <div className="flex flex-col items-center gap-4 pt-[8vh] text-center max-md:pt-6">
      <div className="grid h-12 w-12 place-items-center rounded-full bg-accent-soft text-accent">
        <Icon name="chat" size={24} />
      </div>
      <div>
        <h2 className="text-[20px] font-semibold">무엇이든 물어보세요</h2>
        <p className="mt-1 text-[13px] text-fg2">웹에서 찾아보고, 링크·사진·PDF를 읽고, 내 일정을 확인하거나 캘린더에 바로 넣어 드려요.</p>
      </div>
      {!hasKey && (
        <button onClick={onKey} className="rounded-[8px] bg-accent px-3 py-1.5 text-[13px] font-medium text-white">
          먼저 Claude API 키 넣기
        </button>
      )}
      <div className="grid w-full max-w-[560px] grid-cols-2 gap-2 max-md:grid-cols-1">
        {EXAMPLES.map((t) => (
          <button key={t} onClick={() => onPick(t)} className="rounded-[10px] border border-line px-3 py-2.5 text-left text-[13px] text-fg2 hover:bg-hover hover:text-fg">
            {t}
          </button>
        ))}
        <button onClick={() => onPick('이 글 요약해줘: ')} className="rounded-[10px] border border-line px-3 py-2.5 text-left text-[13px] text-fg2 hover:bg-hover hover:text-fg">
          링크 붙여넣고 요약 부탁하기…
        </button>
      </div>
    </div>
  )
}

function ChatList({ chats, current, onPick, onNew, onDelete }: { chats: Chat[]; current: string | null; onPick: (id: string) => void; onNew: () => void; onDelete: (id: string) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <span className="text-[12px] font-medium text-fg3" title="대화 기록은 이 기기에만 저장되고 동기화되지 않아요">대화 기록</span>
        <button onClick={onNew} className="flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-[6px] px-2 text-[13px] text-fg2 hover:bg-hover" title="새 대화">
          <Icon name="plus" size={14} /> 새 대화
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {chats.length === 0 && <li className="px-2 py-3 text-[13px] text-fg3">아직 대화가 없어요.</li>}
        {chats.map((c) => (
          <li key={c.id} className="group relative">
            <button onClick={() => onPick(c.id)} className={`flex w-full flex-col rounded-[6px] px-2 py-1.5 pr-8 text-left ${c.id === current ? 'bg-active' : 'hover:bg-hover'}`}>
              <span className="truncate text-[13.5px]">{c.title}</span>
              <span className="text-[11px] text-fg3">{isToday(new Date(c.updatedAt)) ? format(new Date(c.updatedAt), 'a h:mm', { locale: ko }) : format(new Date(c.updatedAt), 'M월 d일')}</span>
            </button>
            <button
              onClick={() => onDelete(c.id)}
              className="absolute top-1.5 right-1 grid h-7 w-7 place-items-center rounded text-fg3 opacity-0 group-hover:opacity-100 hover:bg-active pointer-coarse:opacity-100"
              aria-label="대화 지우기"
            >
              <Icon name="trash" size={13} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MessageView({ m, chat }: { m: Msg; chat: Chat }) {
  if (m.role === 'assistant') return <AssistantBlocks blocks={typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content} chat={chat} />
  const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content } as Param] : m.content
  // 도구 결과만 담긴 메시지는 화면에 보이지 않음
  const shown = parts.filter((p) => p.type === 'image' || p.type === 'document' || (p.type === 'text' && !p.text.startsWith(NOW_TAG)))
  if (!shown.length) return null
  return (
    <div className="flex flex-col items-end gap-1.5">
      {shown.map((p, i) =>
        p.type === 'image' && p.source.type === 'base64' ? (
          <img key={i} src={`data:${p.source.media_type};base64,${p.source.data}`} alt="첨부한 사진" className="max-h-48 max-w-[70%] rounded-[10px] border border-line object-contain" />
        ) : p.type === 'document' ? (
          <span key={i} className="flex items-center gap-1 rounded-[8px] bg-hover px-2 py-1 text-[12px] text-fg2">
            <Icon name="file" size={13} /> {p.title ?? 'PDF'}
          </span>
        ) : p.type === 'text' ? (
          <div key={i} className="max-w-[85%] rounded-[14px] rounded-br-[4px] bg-hover px-3.5 py-2 text-[14.5px] whitespace-pre-wrap break-words">
            {p.text.startsWith('[') && p.text.includes(']\n') ? `📎 ${p.text.slice(1, p.text.indexOf(']'))}` : p.text}
          </div>
        ) : null,
      )}
    </div>
  )
}

type Source = { url: string; title: string }

/** Claude 답변: 글, 웹 검색, 캘린더 작업 */
function AssistantBlocks({ blocks, chat, live }: { blocks: Param[]; chat?: Chat; live?: boolean }) {
  const sources: Source[] = []
  const seen = new Set<string>()
  for (const b of blocks)
    if (b.type === 'text')
      for (const c of b.citations ?? [])
        if ('url' in c && c.url && !seen.has(c.url)) {
          seen.add(c.url)
          sources.push({ url: c.url, title: ('title' in c && c.title) || host(c.url) })
        }

  return (
    <div className="flex flex-col gap-2 text-[14.5px] leading-[1.65]">
      {blocks.map((b, i) => {
        if (b.type === 'text') return b.text ? <Markdown key={i} text={b.text} /> : null
        if (b.type === 'server_tool_use') {
          const input = (b.input ?? {}) as { query?: string; url?: string }
          if (b.name === 'web_search') return <Chip key={i} icon="search" text={input.query ? `웹 검색: ${input.query}` : '웹 검색 중…'} />
          if (b.name === 'web_fetch') return <Chip key={i} icon="link" text={input.url ? `페이지 읽기: ${host(input.url)}` : '페이지 읽는 중…'} />
          return null
        }
        if (b.type === 'web_search_tool_result') {
          const c = b.content
          if (!Array.isArray(c)) return <Chip key={i} icon="x" text="검색하지 못했어요" />
          return (
            <details key={i} className="-mt-1 text-[12px] text-fg3">
              <summary className="cursor-pointer select-none">검색 결과 {c.length}개 보기</summary>
              <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                {c.map((r, j) =>
                  r.type === 'web_search_result' ? (
                    <li key={j} className="truncate">
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                        {r.title || r.url}
                      </a>
                    </li>
                  ) : null,
                )}
              </ul>
            </details>
          )
        }
        if (b.type === 'web_fetch_tool_result') {
          const c = b.content as { type: string }
          return c.type === 'web_fetch_tool_result_error' || c.type === 'web_fetch_tool_error' ? <Chip key={i} icon="x" text="페이지를 열지 못했어요" /> : null
        }
        if (b.type === 'tool_use') return <ToolView key={i} b={b} chat={chat} live={live} />
        return null
      })}
      {sources.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-fg3">출처</span>
          {sources.slice(0, 8).map((s, i) => (
            <a key={s.url} href={s.url} target="_blank" rel="noopener noreferrer" title={s.title} className="flex max-w-[220px] items-center gap-1 rounded-full bg-hover px-2 py-0.5 text-[11.5px] text-fg2 hover:bg-active hover:text-fg">
              <span className="text-fg3">{i + 1}</span>
              <span className="truncate">{host(s.url)}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

function Chip({ icon, text }: { icon: 'search' | 'link' | 'x' | 'calendar'; text: string }) {
  return (
    <div className="flex items-center gap-1.5 self-start rounded-full border border-line px-2.5 py-0.5 text-[12px] text-fg2">
      <Icon name={icon} size={12} className="shrink-0 text-fg3" />
      <span className="truncate">{text}</span>
    </div>
  )
}

function ToolView({ b, chat, live }: { b: Extract<Param, { type: 'tool_use' }>; chat?: Chat; live?: boolean }) {
  const { open } = useUI()
  const input = (b.input ?? {}) as { from?: string; to?: string; query?: string | null; id?: string }
  if (b.name === 'search_calendar') return <Chip icon="calendar" text={`내 캘린더 확인${input.from ? ` · ${input.from.slice(5)}~${(input.to ?? '').slice(5)}` : ''}${input.query ? ` · "${input.query}"` : ''}`} />
  const a = chat?.actions[b.id]
  if (!a) return live ? <Chip icon="calendar" text={b.name === 'add_items' ? '캘린더에 넣는 중…' : '할 일 완료 표시 중…'} /> : null
  return (
    <div className={`flex items-start gap-2 rounded-[10px] border px-3 py-2 text-[13px] ${a.undone ? 'border-line text-fg3' : 'border-accent/30 bg-accent-soft'}`}>
      <Icon name={a.kind === 'add' ? 'calendar' : 'check'} size={15} className={`mt-0.5 shrink-0 ${a.undone ? '' : 'text-accent'}`} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{a.undone ? '되돌렸어요' : a.kind === 'add' ? `캘린더에 ${a.undo.created.length}개 넣었어요` : '완료로 표시했어요'}</div>
        <div className={`text-[12.5px] whitespace-pre-line ${a.undone ? 'line-through' : 'text-fg2'}`}>{a.summary}</div>
      </div>
      {!a.undone && (
        <div className="flex shrink-0 gap-1">
          {a.kind === 'add' && a.undo.created.length === 1 && (
            <button onClick={() => open(a.undo.created[0])} className="rounded-[6px] px-2 py-0.5 text-[12px] text-fg2 hover:bg-hover">
              열기
            </button>
          )}
          <button onClick={() => chat && void undoAction(chat.id, b.id)} className="rounded-[6px] px-2 py-0.5 text-[12px] text-fg2 hover:bg-hover">
            되돌리기
          </button>
        </div>
      )}
    </div>
  )
}
