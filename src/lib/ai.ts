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

function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않아요. 설정에서 키를 확인해 주세요.'
  if (e instanceof Anthropic.PermissionDeniedError) return '이 API 키로는 선택한 모델을 쓸 수 없어요. 설정에서 다른 모델을 골라 보세요.'
  if (e instanceof Anthropic.RateLimitError) return '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.'
  if (e instanceof Anthropic.BadRequestError) return `요청을 처리할 수 없어요: ${e.message}`
  if (e instanceof Anthropic.APIUserAbortError) return '취소했어요.'
  if (e instanceof Anthropic.APIConnectionError) return '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'
  if (e instanceof Anthropic.APIError) return `API 오류 (${e.status}): ${e.message}`
  return e instanceof Error ? e.message : String(e)
}

