// AI 채팅: Claude 와 대화하며 웹 검색 + 내 캘린더 도구 사용 (스트리밍)
import Anthropic from '@anthropic-ai/sdk'
import * as z from 'zod/v4'
import { db, type ChatAction } from '../db'
import type { AISettings } from './importFiles'
import { friendlyError } from './ai'
import { addItems, completeTask, nowNote, saveChat, searchCalendar } from './chat'

type Msg = Anthropic.Beta.BetaMessageParam
type Block = Anthropic.Beta.BetaContentBlock

const SYSTEM = `당신은 사용자의 개인 캘린더 앱 안에 있는 AI 채팅 도우미입니다.
일정 관리뿐 아니라 검색, 설명, 요약, 글쓰기, 번역, 계산, 아이디어 등 어떤 질문에도 답합니다.

- 최신 정보나 바뀔 수 있는 정보(뉴스, 가격, 날씨, 영업시간, 일정, 제품 정보 등), 정확한 사실 확인이 필요한 질문은 web_search 로 찾아보고 답합니다. 사용자가 링크를 주면 web_fetch 로 읽습니다.
- 사용자의 일정·할 일에 관한 질문은 search_calendar 로 확인한 뒤 답하고, 확인하지 않은 일정을 지어내지 않습니다.
- 사용자가 캘린더에 넣어 달라고 하면 add_items 로 넣습니다. 날짜나 시간이 정말 모호할 때만 먼저 물어봅니다. 넣은 뒤에는 무엇을 넣었는지 짧게 알려 줍니다(화면에 되돌리기 버튼이 있습니다).
- complete_task 는 사용자가 끝냈다고 말한 할 일에만 씁니다.
- 한국어로, 휴대폰에서도 읽기 쉽게 간결하게 답합니다. 필요하면 마크다운(목록, 표, 굵게)을 씁니다.
- 사용자 메시지 끝의 '[앱 정보]' 줄은 앱이 붙인 현재 시각입니다. "오늘", "다음 주" 같은 말은 이 시각을 기준으로 계산합니다.`

const SearchSchema = z.object({ from: z.string(), to: z.string(), query: z.string().nullish() })
const AddSchema = z.object({
  items: z
    .array(
      z.object({
        type: z.enum(['event', 'task']),
        title: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        start_time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
        end_time: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
        note: z.string().nullish(),
      }),
    )
    .min(1)
    .max(30),
})
const DoneSchema = z.object({ id: z.string() })

const CLIENT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_calendar',
    description: '사용자 캘린더에서 기간 안의 일정·할 일을 찾습니다(반복 일정과 구독 캘린더 포함). 최대 3개월. query 를 주면 제목·메모·태그·프로젝트에 그 글자가 들어간 것만 돌려주고, 날짜 없는 할 일도 함께 찾습니다.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: '시작 날짜 YYYY-MM-DD' },
        to: { type: 'string', description: '끝 날짜 YYYY-MM-DD (포함)' },
        query: { type: ['string', 'null'], description: '찾을 글자. 전체를 보려면 null' },
      },
      required: ['from', 'to'],
    },
    eager_input_streaming: true,
  },
  {
    name: 'add_items',
    description: '사용자 캘린더에 일정(event) 또는 할 일(task)을 새로 넣습니다. 시간이 있으면 start_time 과 end_time 을 둘 다 주고, 없으면 둘 다 null 로 둡니다(일정은 종일, 할 일은 그날 마감).',
    input_schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['event', 'task'] },
              title: { type: 'string' },
              date: { type: 'string', description: 'YYYY-MM-DD' },
              start_time: { type: ['string', 'null'], description: 'HH:MM (24시간)' },
              end_time: { type: ['string', 'null'], description: 'HH:MM (24시간)' },
              note: { type: ['string', 'null'], description: '장소·준비물·링크 등 메모' },
            },
            required: ['type', 'title', 'date'],
          },
        },
      },
      required: ['items'],
    },
    eager_input_streaming: true,
  },
  {
    name: 'complete_task',
    description: '할 일을 완료로 표시합니다. id 는 search_calendar 결과의 id 를 그대로 씁니다.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    eager_input_streaming: true,
  },
]

function tools(model: string): Anthropic.Beta.BetaToolUnion[] {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const user_location = { type: 'approximate' as const, timezone: tz, ...(tz === 'Asia/Seoul' ? { country: 'KR' } : {}) }
  // 동적 필터링 버전은 Opus·Sonnet 에서만, Haiku 는 기본 버전
  const web: Anthropic.Beta.BetaToolUnion[] = model.startsWith('claude-haiku')
    ? [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 5, user_location },
        { type: 'web_fetch_20250910', name: 'web_fetch', max_uses: 5 },
      ]
    : [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 5, user_location },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 },
      ]
  return [...CLIENT_TOOLS, ...web]
}

async function runTool(block: Anthropic.Beta.BetaToolUseBlock): Promise<{ content: string; isError?: boolean; action?: ChatAction }> {
  const bad = () => ({ content: JSON.stringify({ INVALID_INPUT: JSON.stringify(block.input) }), isError: true })
  try {
    if (block.name === 'search_calendar') {
      const p = SearchSchema.safeParse(block.input)
      return p.success ? { content: JSON.stringify(await searchCalendar(p.data)) } : bad()
    }
    if (block.name === 'add_items') {
      const p = AddSchema.safeParse(block.input)
      if (!p.success) return bad()
      const r = await addItems(p.data)
      return { content: JSON.stringify(r.result), action: r.action }
    }
    if (block.name === 'complete_task') {
      const p = DoneSchema.safeParse(block.input)
      if (!p.success) return bad()
      const r = await completeTask(p.data)
      return { content: JSON.stringify(r.result), action: r.action }
    }
    return { content: `알 수 없는 도구: ${block.name}`, isError: true }
  } catch (e) {
    return { content: `도구 실행 중 오류: ${e instanceof Error ? e.message : String(e)}`, isError: true }
  }
}

export type UserPart = { kind: 'text'; text: string } | { kind: 'image'; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } | { kind: 'pdf'; data: string; name: string }

export type TurnResult = { ok: true } | { ok: false; message: string; restore?: string }

/**
 * 사용자 메시지 하나를 보내고, 도구 사용이 끝날 때까지 이어서 답을 받는다.
 * 끝난 단계마다 대화를 저장하고, 진행 중인 답은 onLive 로 알려 준다.
 */
export async function sendTurn(chatId: string, parts: UserPart[], settings: AISettings, onLive: (blocks: Block[] | null, status?: string) => void, signal: AbortSignal): Promise<TurnResult> {
  const chat = await db.chats.get(chatId)
  if (!chat) return { ok: false, message: '대화를 찾지 못했어요.' }
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })
  const isHaiku = settings.model.startsWith('claude-haiku')
  const text = parts.find((p) => p.kind === 'text')?.text ?? ''

  const content: Anthropic.Beta.BetaContentBlockParam[] = parts.map((p) =>
    p.kind === 'image'
      ? { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data } }
      : p.kind === 'pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: p.data }, title: p.name }
        : { type: 'text', text: p.text },
  )
  content.push({ type: 'text', text: nowNote() })

  const base = chat.messages as Msg[]
  const messages: Msg[] = [...base, { role: 'user', content }]
  const actions = { ...chat.actions }
  const usage = { input: 0, output: 0, cacheRead: 0, searches: 0, ...chat.usage }
  const title = chat.messages.length === 0 && text.trim() ? text.trim().replace(/\s+/g, ' ').slice(0, 40) : chat.title
  const save = () => saveChat(chatId, { messages, actions, usage, title })
  await save()

  /** 이번 턴을 중간에 멈출 때: 아직 답이 없으면 질문을 되돌리고, 있으면 안내 문장으로 마무리 */
  const finishEarly = async (note: string, message: string): Promise<TurnResult> => {
    onLive(null)
    if (messages.length === base.length + 1) {
      await saveChat(chatId, { messages: base, actions, usage, title: chat.title })
      return { ok: false, message, restore: text }
    }
    // 바로 앞이 Claude 의 답(예: 검색 중 멈춤)이면 그대로 두고, 도구 결과로 끝났으면 안내 문장으로 마무리
    if (messages[messages.length - 1].role === 'user') messages.push({ role: 'assistant', content: [{ type: 'text', text: note }] })
    await save()
    return { ok: false, message }
  }

  let retries = 0
  for (let step = 0; step < 12; step++) {
    let msg: Anthropic.Beta.BetaMessage
    try {
      const stream = client.beta.messages.stream(
        {
          model: settings.model,
          max_tokens: 32000,
          system: SYSTEM,
          messages,
          tools: tools(settings.model),
          cache_control: { type: 'ephemeral' }, // 긴 대화를 다시 보낼 때 비용 절약
          output_config: { effort: 'medium' },
          ...(isHaiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
        },
        { signal },
      )
      stream.on('streamEvent', (_e, snap) => onLive([...snap.content]))
      msg = await stream.finalMessage()
      retries = 0
    } catch (e) {
      if (signal.aborted || e instanceof Anthropic.APIUserAbortError) return finishEarly('(답변을 멈췄어요)', '멈췄어요.')
      // 도구 입력을 해석하지 못했거나 연결이 끊긴 경우 한 번 더
      if (!(e instanceof Anthropic.APIError) && retries++ < 2) continue
      return finishEarly('(오류로 답변이 끊겼어요)', friendlyError(e))
    }

    usage.input += msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0)
    usage.cacheRead += msg.usage.cache_read_input_tokens ?? 0
    usage.output += msg.usage.output_tokens
    usage.searches += msg.usage.server_tool_use?.web_search_requests ?? 0

    if (msg.stop_reason === 'refusal') return finishEarly('(이 요청에는 답할 수 없어요)', '이 요청에는 답할 수 없다는 응답을 받았어요. 다르게 물어봐 주세요.')

    const toolUses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')
    if (msg.stop_reason === 'max_tokens' && toolUses.length) return finishEarly('(답이 너무 길어 잘렸어요)', '답이 너무 길어 잘렸어요.')

    messages.push({ role: 'assistant', content: msg.content as Anthropic.Beta.BetaContentBlockParam[] })

    if (msg.stop_reason === 'pause_turn') {
      await save()
      continue // 서버 도구(웹 검색)가 길어져 잠시 멈춤 → 그대로 이어서
    }
    if (!toolUses.length) {
      await save()
      onLive(null)
      return msg.stop_reason === 'max_tokens' ? { ok: false, message: '답이 길어 중간에 잘렸어요. "계속"이라고 보내면 이어서 써요.' } : { ok: true }
    }

    onLive([...msg.content], '캘린더 확인 중…')
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const t of toolUses) {
      const r = await runTool(t)
      if (r.action) actions[t.id] = r.action
      results.push({ type: 'tool_result', tool_use_id: t.id, content: r.content, ...(r.isError ? { is_error: true } : {}) })
    }
    messages.push({ role: 'user', content: results })
    await save()
    if (signal.aborted) return finishEarly('(답변을 멈췄어요)', '멈췄어요.')
  }
  return finishEarly('(작업이 너무 길어져 멈췄어요)', '단계가 너무 많아 멈췄어요. 나눠서 물어봐 주세요.')
}
