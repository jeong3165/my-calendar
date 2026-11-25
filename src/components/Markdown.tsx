import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

/* 마크다운 (링크는 새 창, 위험한 태그는 제거) */
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true }) as string), [text])
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
}
