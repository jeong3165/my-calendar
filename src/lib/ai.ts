import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import * as z from 'zod/v4'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import type { AISettings, ImportSource } from './importFiles'

/* ───────── 추출 결과 스키마 (구조화 출력) ───────── */
const FIELD = z.enum(['title', 'date', 'end_date', 'start_time', 'end_time', 'location'])

export const ExtractedSchema = z.object({
  items: z.array(
    z.object({
      type: z.enum(['event', 'task']).describe('시간/장소가 있는 약속·행사는 event, 해야 할 일·마감은 task'),
      title: z.string().describe('짧고 명확한 제목'),
      date: z.string().nullable().describe('YYYY-MM-DD. 알 수 없으면 null'),
      end_date: z.string().nullable().describe('여러 날 일정의 마지막 날 YYYY-MM-DD, 하루짜리면 null'),
      start_time: z.string().nullable().describe('24시간 HH:MM, 종일이거나 모르면 null'),
      end_time: z.string().nullable().describe('24시간 HH:MM, 모르면 null'),
      location: z.string().nullable(),
      note: z.string().nullable().describe('준비물·연락처 등 참고 사항'),
      tags: z.array(z.string()).describe('0~2개의 짧은 한국어 태그'),
      uncertain: z.array(FIELD).describe('글자가 흐리거나, 추측했거나, 해석이 여러 가지인 필드'),
      uncertain_reason: z.string().nullable().describe('uncertain 이 있으면 무엇이 왜 불확실한지 한 문장'),
      source_text: z.string().describe('이 항목의 근거가 된 원문을 그대로 옮긴 것'),
    }),
  ),
  notice: z.string().nullable().describe('사용자에게 알릴 점(예: 일정이 없음, 일부가 잘려 보임). 없으면 null'),
})
export type Extracted = z.infer<typeof ExtractedSchema>
export type ExtractedItem = Extracted['items'][number]

const SYSTEM = `당신은 개인 캘린더 앱의 일정 추출기입니다.
사용자가 올린 스크린샷, 사진, PDF, 텍스트(메신저 대화, 공지문, 포스터, 청첩장, 예약 확인 문자, 시간표, 이메일 등)에서
캘린더에 넣을 일정(event)과 할 일(task)을 찾아 구조화합니다.

규칙:
- 원문에 있는 정보만 사용하고, 없는 정보는 지어내지 말고 null 로 둡니다.
- 상대적인 날짜("내일", "다음 주 금요일", "이번 달 말")는 사용자가 알려준 오늘 날짜를 기준으로 계산합니다.
- 연도가 없으면 오늘 이후로 가장 가까운 날짜로 정합니다.
- "오후 3시"는 15:00 으로, "3시"처럼 오전/오후가 없으면 맥락으로 판단하고 uncertain 에 start_time 을 넣습니다.
- 글자가 흐리거나 잘린 경우, 숫자를 추측한 경우, 요일과 날짜가 서로 맞지 않는 경우에는 해당 필드를 uncertain 에 넣고 이유를 적습니다.
- 사용자가 직접 확인하고 고친 뒤 저장하므로, 확신이 없으면 uncertain 으로 표시하는 편이 좋습니다.
- 같은 일정을 중복으로 만들지 않습니다. 캘린더와 무관한 내용은 무시합니다.
- 일정이 하나도 없으면 items 를 빈 배열로 두고 notice 에 이유를 적습니다.`

export async function extractSchedule(sources: ImportSource[], hint: string, settings: AISettings, signal?: AbortSignal): Promise<Extracted> {
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })
  const now = new Date()

  const content: Anthropic.Beta.BetaContentBlockParam[] = []
  for (const s of sources) {
    if (s.kind === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: s.mediaType, data: s.data } })
    else if (s.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: s.data } })
    else content.push({ type: 'text', text: `[${s.name}]\n${s.text}` })
  }
  content.push({
    type: 'text',
    text:
      `오늘은 ${format(now, 'yyyy-MM-dd (EEEE) HH:mm', { locale: ko })} 이고, 시간대는 ${Intl.DateTimeFormat().resolvedOptions().timeZone} 입니다.\n` +
      `위 자료에서 일정과 할 일을 추출해 주세요.` +
      (hint.trim() ? `\n\n사용자 메모: ${hint.trim()}` : ''),
  })

  const isHaiku = settings.model.startsWith('claude-haiku')
  try {
    const res = await client.beta.messages.parse(
      {
        model: settings.model,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: 'user', content }],
        output_config: { effort: 'medium', format: betaZodOutputFormat(ExtractedSchema) },
        // 안전 분류기가 요청을 거절하면 서버에서 권장 모델로 다시 시도 (Haiku 는 미지원)
        ...(isHaiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      },
      { signal },
    )
    if (res.stop_reason === 'refusal') throw new Error('이 자료는 분석할 수 없다는 응답을 받았어요. 다른 이미지로 시도해 주세요.')
    if (res.stop_reason === 'max_tokens') throw new Error('자료가 너무 길어 결과가 잘렸어요. 파일을 나눠서 올려 주세요.')
    if (!res.parsed_output) throw new Error('결과를 해석하지 못했어요. 다시 시도해 주세요.')
    return res.parsed_output
  } catch (e) {
    throw new Error(friendlyError(e))
  }
}

export function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않아요. 설정에서 키를 확인해 주세요.'
  if (e instanceof Anthropic.PermissionDeniedError) return '이 API 키로는 선택한 모델을 쓸 수 없어요. 설정에서 다른 모델을 골라 보세요.'
  if (e instanceof Anthropic.RateLimitError) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.'
  // 선불 크레딧이 바닥났을 때 (전용 오류 종류가 없어 안내 문구로 구분)
  if (e instanceof Anthropic.APIError && /credit balance is too low/i.test(e.message))
    return 'Claude 크레딧(선불 잔액)이 부족해요. platform.claude.com → Billing(결제)에서 크레딧을 충전하면 바로 다시 쓸 수 있어요.'
  if (e instanceof Anthropic.BadRequestError) return `요청을 처리할 수 없어요: ${e.message}`
  if (e instanceof Anthropic.APIUserAbortError) return '취소했어요.'
  if (e instanceof Anthropic.APIConnectionError) return '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'
  if (e instanceof Anthropic.APIError) return `API 오류 (${e.status}): ${e.message}`
  return e instanceof Error ? e.message : String(e)
}


/* ═════════ AI 일정 비서 ═════════ */
export const PlanSchema = z.object({
  summary: z.string().describe('무엇을 어떻게 배치했는지 2~3문장 요약 (한국어)'),
  actions: z.array(
    z.object({
      kind: z.enum(['create', 'schedule', 'move', 'set_due']).describe('create=새 일정/할 일, schedule=기존 할 일에 시간 블록, move=기존 항목 날짜·시간 옮기기, set_due=할 일 마감일만 변경'),
      item_id: z.string().nullable().describe('기존 항목을 바꿀 때 그 id. create 면 null'),
      type: z.enum(['event', 'task']).nullable().describe('create 일 때만: 시간 약속은 event, 해야 할 일은 task'),
      title: z.string().nullable().describe('create 일 때 제목'),
      date: z.string().describe('YYYY-MM-DD'),
      start_time: z.string().nullable().describe('HH:MM (24시간). 날짜만 바꿀 때는 null'),
      end_time: z.string().nullable().describe('HH:MM (24시간)'),
      project: z.string().nullable().describe('create 일 때 넣을 프로젝트 이름 (목록에 있는 것만)'),
      reason: z.string().describe('이렇게 배치한 이유 한 문장'),
    }),
  ),
  question: z.string().nullable().describe('요청이 모호해서 확인이 필요하면 사용자에게 할 질문. 아니면 null'),
})
export type Plan = z.infer<typeof PlanSchema>

const PLANNER = `당신은 개인 캘린더 앱의 일정 비서입니다. 사용자의 요청을 받아 캘린더에 반영할 '제안'을 만듭니다.
제안은 사용자가 검토하고 고친 뒤에 적용하므로, 실제로 저장하지는 않습니다.

함께 주어지는 자료:
- [빈 시간]: 날짜별로 비어 있는 시간대. 새 일정·시간 블록은 반드시 이 안에 넣습니다.
- [범위 안의 일정]: fixed=true 인 일정(반복·구독·지난 일정)은 절대 옮기지 않습니다.
- [아직 안 끝난 할 일]: id 로 가리킵니다. 마감일(due)과 우선순위(priority)를 고려합니다.

규칙:
- 겹치게 배치하지 않습니다. 같은 응답 안의 제안끼리도 겹치면 안 됩니다.
- 마감일이 있는 할 일은 마감일 전에, 우선순위 high 는 먼저 배치합니다.
- 길이를 말하지 않으면 할 일은 30~60분, 운동·공부 같은 활동은 1시간으로 합니다. 하루에 같은 활동을 몰아넣지 말고 고르게 나눕니다.
- 사용자가 아침/저녁/주말 등 시간대를 말하면 그 범위 안에서 고릅니다. 빈 시간이 모자라면 가능한 만큼만 하고 summary 에 부족하다고 적습니다.
- 기존 할 일에 시간을 정해 주는 것은 schedule, 기존 일정·할 일의 날짜를 바꾸는 것은 move, 마감일만 바꾸는 것은 set_due 입니다.
- 요청과 관계없는 항목은 건드리지 않습니다. 제안은 최대 30개입니다.
- 요청이 모호해서 정하기 어려우면 actions 를 비우고 question 에 짧게 물어봅니다.
- 날짜는 YYYY-MM-DD, 시간은 24시간 HH:MM, 모든 문장은 한국어로 씁니다.`

export type PlanTurn = { role: 'user' | 'assistant'; content: string }

/** history: 이전 대화 (첫 user 메시지에 캘린더 자료 포함) */
export async function planSchedule(history: PlanTurn[], settings: AISettings, signal?: AbortSignal): Promise<Plan> {
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })
  const isHaiku = settings.model.startsWith('claude-haiku')
  try {
    const res = await client.beta.messages.parse(
      {
        model: settings.model,
        max_tokens: 16000,
        system: PLANNER,
        messages: history,
        output_config: { effort: 'medium', format: betaZodOutputFormat(PlanSchema) },
        ...(isHaiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
      },
      { signal },
    )
    if (res.stop_reason === 'refusal') throw new Error('이 요청은 처리할 수 없다는 응답을 받았어요. 다르게 표현해 보세요.')
    if (res.stop_reason === 'max_tokens') throw new Error('제안이 너무 길어 잘렸어요. 범위를 좁혀서 다시 요청해 주세요.')
    if (!res.parsed_output) throw new Error('결과를 해석하지 못했어요. 다시 시도해 주세요.')
    return res.parsed_output
  } catch (e) {
    throw new Error(friendlyError(e))
  }
}


/* ═════════ 아침 브리핑 AI 한마디 ═════════ */
const BRIEFER = `당신은 개인 캘린더 앱의 아침 브리핑 도우미입니다. 사용자의 오늘 일정과 할 일 자료를 보고 하루를 시작하는 짧은 브리핑을 씁니다.
- 한국어로 3~5문장, 다정하지만 군더더기 없이 씁니다. 마크다운 제목이나 목록은 쓰지 않고, 강조가 필요하면 **굵게**만 씁니다.
- 가장 먼저 챙길 것(이른 시간 일정, 밀린 할 일, 오늘·곧 마감)을 짚고, 일정 사이 빈 시간에 할 일을 처리하라는 식의 실용적인 제안을 하나 덧붙입니다.
- 자료에 없는 일정이나 할 일을 지어내지 않습니다.
- 날씨를 알려 달라는 요청이 있으면 web_search 로 그 도시의 오늘 날씨를 찾아 한 문장으로 넣고, 외출 일정이 있으면 우산·옷차림을 짧게 조언합니다. 찾지 못하면 날씨 이야기는 빼세요.`

export async function briefingNote(data: unknown, city: string, settings: AISettings, signal?: AbortSignal): Promise<string> {
  const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true })
  const isHaiku = settings.model.startsWith('claude-haiku')
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const tools: Anthropic.Beta.BetaToolUnion[] = city
    ? [
        isHaiku
          ? { type: 'web_search_20250305', name: 'web_search', max_uses: 2, user_location: { type: 'approximate', timezone: tz } }
          : { type: 'web_search_20260209', name: 'web_search', max_uses: 2, user_location: { type: 'approximate', timezone: tz } },
      ]
    : []
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: 'user',
      content:
        `오늘 자료(JSON):\n${JSON.stringify(data)}\n\n` +
        `지금은 ${format(new Date(), 'yyyy-MM-dd (EEEE) HH:mm', { locale: ko })} 입니다.` +
        (city ? ` ${city}의 오늘 날씨도 넣어 주세요.` : ''),
    },
  ]
  try {
    for (let i = 0; i < 4; i++) {
      const res = await client.beta.messages.create(
        {
          model: settings.model,
          max_tokens: 4000,
          system: BRIEFER,
          messages,
          ...(tools.length ? { tools } : {}),
          output_config: { effort: 'low' },
          ...(isHaiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }),
        },
        { signal },
      )
      if (res.stop_reason === 'refusal') throw new Error('브리핑을 만들 수 없다는 응답을 받았어요.')
      if (res.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: res.content as Anthropic.Beta.BetaContentBlockParam[] })
        continue
      }
      // 웹 검색을 쓰면 글이 여러 조각으로 나뉘므로 마지막 검색 뒤의 글만 모은다
      const lastTool = res.content.map((b) => b.type).lastIndexOf('web_search_tool_result')
      const text = res.content
        .slice(lastTool + 1)
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('')
        .trim()
      if (!text) throw new Error('브리핑 내용이 비어 있어요.')
      return text
    }
    throw new Error('브리핑을 만드는 데 너무 오래 걸렸어요.')
  } catch (e) {
    throw new Error(friendlyError(e))
  }
}

/* ═════════ API 키 확인 (요금 없음: 모델 정보 조회) ═════════ */
export async function checkKey(apiKey: string, model: string): Promise<{ ok: true; name: string } | { ok: false; message: string; detail: string }> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 })
  try {
    const m = await client.models.retrieve(model)
    return { ok: true, name: m.display_name }
  } catch (e) {
    const detail = e instanceof Anthropic.APIError ? `HTTP ${e.status ?? '-'} · ${e.message}` : e instanceof Error ? e.message : String(e)
    return { ok: false, message: friendlyError(e), detail }
  }
}
