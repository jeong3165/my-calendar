import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createItem, useItems } from '../db'
import { useUI } from '../store'
import { fileToSource, loadSettings, type ImportSource } from '../lib/importFiles'
import { blankDraft, dateLabel, draftToItem, findDuplicate, fromExtracted, fromICS, fromPlainText, validate, type Draft, type Problems } from '../lib/drafts'
import { parseYmd, relDay } from '../lib/date'
import { Checkbox, Icon } from './ui'

type Stage = 'input' | 'loading' | 'review'
type Pending = { id: string; file: File; source?: ImportSource; error?: string }

const isICS = (f: File) => /\.ics$/i.test(f.name) || f.type === 'text/calendar'
let pid = 0

export function ImportDialog() {
  const { importSeed, closeImport, setSettings, settingsOpen, setDate, showToast } = useUI()
  const items = useItems()
  const [stage, setStage] = useState<Stage>('input')
  const [pending, setPending] = useState<Pending[]>([])
  const [text, setText] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState(0)
  const [hasKey, setHasKey] = useState(() => !!loadSettings().apiKey)
  const abortRef = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 설정 창을 닫고 돌아오면 키 상태 갱신
  useEffect(() => {
    if (!settingsOpen) setHasKey(!!loadSettings().apiKey)
  }, [settingsOpen])

  // 열릴 때 + 열린 상태에서 붙여넣기/드롭으로 들어온 파일 추가
  const seenTick = useRef(-1)
  useEffect(() => {
    if (seenTick.current === importSeed.tick) return // StrictMode 이중 실행 방지
    seenTick.current = importSeed.tick
    if (importSeed.files.length) addFiles(importSeed.files)
    if (importSeed.text) setText((t) => (t ? `${t}\n${importSeed.text}` : importSeed.text))
    if (importSeed.files.length || importSeed.text) setStage((s) => (s === 'loading' ? s : 'input'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importSeed.tick])

  function addFiles(files: File[]) {
    const list = files.map((file) => ({ id: `p${pid++}`, file }))
    setPending((p) => [...p, ...list])
    for (const p of list) {
      if (isICS(p.file)) continue
      fileToSource(p.file).then(
        (source) => setPending((all) => all.map((x) => (x.id === p.id ? { ...x, source } : x))),
        (e: Error) => setPending((all) => all.map((x) => (x.id === p.id ? { ...x, error: e.message } : x))),
      )
    }
  }

  const sources = pending.filter((p) => p.source).map((p) => p.source!)
  const images = sources.filter((s): s is Extract<ImportSource, { kind: 'image' }> => s.kind === 'image')
  const icsFiles = pending.filter((p) => isICS(p.file))
  const aiSources = sources
  const stillReading = pending.some((p) => !isICS(p.file) && !p.source && !p.error)
  const needsKey = aiSources.some((s) => s.kind !== 'text')
  const canAnalyze = !stillReading && (pending.some((p) => !p.error) || text.trim().length > 0)

  async function analyze() {
    setError(null)
    setNotice(null)
    const out: Draft[] = []
    for (const p of icsFiles) out.push(...fromICS(await p.file.text()))

    const settings = loadSettings()
    const textOnly = aiSources.length === 0
    if (aiSources.length || (text.trim() && settings.apiKey)) {
      if (!settings.apiKey) {
        if (needsKey) {
          setError('이미지·PDF를 읽으려면 Claude API 키가 필요해요. 오른쪽 위 설정에서 키를 넣어 주세요.')
          return
        }
        for (const s of aiSources) if (s.kind === 'text') out.push(...fromPlainText(s.text))
        if (text.trim()) out.push(...fromPlainText(text))
      } else {
        setStage('loading')
        const ctrl = new AbortController()
        abortRef.current = ctrl
        try {
          const src: ImportSource[] = textOnly ? [{ kind: 'text', name: '붙여넣은 텍스트', text }] : aiSources
          const { extractSchedule } = await import('../lib/ai')
          const res = await extractSchedule(src, textOnly ? '' : text, settings, ctrl.signal)
          out.push(...res.items.map(fromExtracted))
          if (res.notice) setNotice(res.notice)
        } catch (e) {
          setError((e as Error).message)
          setStage('input')
          return
        } finally {
          abortRef.current = null
        }
      }
    } else if (text.trim()) {
      out.push(...fromPlainText(text))
    }

    // 중복 의심 항목은 기본으로 선택 해제
    setDrafts(out.map((d) => (findDuplicate(d, items) ? { ...d, include: false } : d)))
    if (out.length === 0) setNotice((n) => n ?? '일정을 찾지 못했어요. 직접 추가하거나 다른 자료로 다시 시도해 보세요.')
    setPreview(0)
    setStage('review')
  }

  const problems = useMemo(() => new Map(drafts.map((d) => [d.key, validate(d)])), [drafts])
  const included = drafts.filter((d) => d.include)
  const broken = included.filter((d) => Object.keys(problems.get(d.key) ?? {}).length > 0)
  const unsure = included.filter((d) => d.uncertain.length > 0)

  function update(key: string, patch: Partial<Draft>, field?: string) {
    setDrafts((ds) =>
      ds.map((d) => (d.key === key ? { ...d, ...patch, uncertain: field ? d.uncertain.filter((u) => u !== field) : d.uncertain } : d)),
    )
  }

  async function save() {
    if (!included.length || broken.length) return
    for (const d of included) await createItem(draftToItem(d))
    const first = included.map((d) => d.date).filter(Boolean).sort()[0]
    if (first) setDate(parseYmd(first))
    showToast(`${included.length}개를 캘린더에 추가했어요.`)
    closeImport()
  }

  function close() {
    abortRef.current?.abort()
    if (stage === 'review' && drafts.length && !confirm('검토 중인 항목이 저장되지 않아요. 닫을까요?')) return
    closeImport()
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/30 md:items-start md:px-4 md:pt-[6vh]" onMouseDown={close}>
      <div
        role="dialog"
        aria-label="이미지·파일에서 일정 가져오기"
        onMouseDown={(e) => e.stopPropagation()}
        className={`shadow-pop flex w-full flex-col overflow-hidden bg-popover md:max-h-[88vh] md:rounded-[12px] ${stage === 'review' ? 'md:max-w-[1080px]' : 'md:max-w-[640px]'}`}
      >
        {/* 헤더 */}
        <div className="flex items-center gap-2 border-b border-line px-5 py-3">
          <Icon name="sparkle" size={18} className="text-accent" />
          <h2 className="text-[16px] font-semibold">{stage === 'review' ? '추출 결과 확인' : '이미지·파일에서 일정 가져오기'}</h2>
          <div className="flex-1" />
          <button onClick={() => setSettings(true)} className="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[13px] text-fg2 hover:bg-hover" title="AI 설정">
            <Icon name="settings" size={15} /> 설정
          </button>
          <button onClick={close} className="grid h-7 w-7 place-items-center rounded-[6px] text-fg2 hover:bg-hover" aria-label="닫기">
            <Icon name="x" size={16} />
          </button>
        </div>

        {stage === 'input' && (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
            {!hasKey && (
              <div className="flex items-start gap-2 rounded-[8px] px-3 py-2.5 text-[13px]" style={{ background: 'var(--c-yellow-bg)', color: 'var(--c-yellow-text)' }}>
                <Icon name="alert" size={16} className="mt-0.5" />
                <div className="flex-1">
                  스크린샷·사진·PDF를 읽으려면 <b>Claude API 키</b>가 필요해요. 키가 없어도 <b>.ics 파일</b>과 <b>한 줄에 하나씩 적은 텍스트</b>는 가져올 수 있어요.
                </div>
                <button onClick={() => setSettings(true)} className="shrink-0 rounded-[4px] px-2 py-0.5 font-medium underline underline-offset-2">
                  키 넣기
                </button>
              </div>
            )}

            <DropZone onFiles={addFiles} fileRef={fileRef} />

            {pending.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {pending.map((p) => (
                  <li key={p.id} className={`relative flex w-[132px] flex-col overflow-hidden rounded-[8px] border ${p.error ? 'border-danger' : 'border-line-strong'}`}>
                    <div className="grid h-[84px] place-items-center bg-sidebar">
                      {p.source?.kind === 'image' ? (
                        <img src={p.source.preview} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <Icon name={p.source || isICS(p.file) ? 'file' : 'clock'} size={26} className="text-fg3" />
                      )}
                    </div>
                    <div className="truncate px-2 py-1 text-[12px]" title={p.error ?? p.file.name}>
                      {p.error ? <span className="text-danger">{p.error}</span> : p.file.name || '붙여넣은 이미지'}
                    </div>
                    <button
                      onClick={() => setPending((all) => all.filter((x) => x.id !== p.id))}
                      className="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white hover:bg-black/75"
                      aria-label="빼기"
                    >
                      <Icon name="x" size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-medium text-fg2">텍스트 붙여넣기 또는 참고 메모 (선택)</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={4}
                placeholder={'예) 카톡 공지 내용을 그대로 붙여넣기\n예) "이건 아이 학원 시간표야, 매주 반복이 아니라 이번 주만"'}
                className="resize-y rounded-[8px] border border-line-strong bg-bg px-3 py-2 text-[14px] outline-none focus:border-accent"
              />
            </label>

            {error && (
              <p className="flex items-start gap-1.5 text-[13px] text-danger">
                <Icon name="alert" size={15} className="mt-0.5" />
                {error}
              </p>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <p className="text-[12px] text-fg3">저장하기 전에 결과를 확인하고 고칠 수 있어요.</p>
              <button
                onClick={analyze}
                disabled={!canAnalyze}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-[6px] bg-accent px-4 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40"
              >
                <Icon name="sparkle" size={15} />
                {stillReading ? '파일 읽는 중…' : '일정 찾기'}
              </button>
            </div>
          </div>
        )}

        {stage === 'loading' && (
          <div className="flex flex-col items-center gap-3 px-5 py-16 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
            <p className="text-[15px] font-medium">자료를 읽고 일정을 찾는 중이에요…</p>
            <p className="text-[13px] text-fg2">이미지가 많거나 크면 30초 정도 걸릴 수 있어요.</p>
            <button
              onClick={() => {
                abortRef.current?.abort()
                setStage('input')
              }}
              className="mt-2 rounded-[6px] border border-line-strong px-3 py-1 text-[13px] hover:bg-hover"
            >
              취소
            </button>
          </div>
        )}

        {stage === 'review' && (
          <>
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              {images.length > 0 && (
                <aside className="flex max-h-[30vh] shrink-0 flex-col gap-2 overflow-y-auto border-b border-line bg-sidebar p-3 md:max-h-none md:w-[360px] md:border-r md:border-b-0">
                  <div className="text-[12px] font-medium text-fg3">원본과 비교해 보세요</div>
                  {images.length > 1 && (
                    <div className="flex gap-1.5">
                      {images.map((img, i) => (
                        <button key={i} onClick={() => setPreview(i)} className={`h-12 w-12 overflow-hidden rounded-[4px] border-2 ${i === preview ? 'border-accent' : 'border-transparent'}`}>
                          <img src={img.preview} alt="" className="h-full w-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                  <a href={images[preview]?.preview} target="_blank" rel="noreferrer" title="새 탭에서 크게 보기">
                    <img src={images[preview]?.preview} alt={images[preview]?.name} className="w-full rounded-[6px] border border-line" />
                  </a>
                </aside>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-[13px]">
                  <span className="font-medium">{drafts.length}개를 찾았어요.</span>
                  <span className="text-fg2">내용이 맞는지 확인하고, 틀린 부분은 바로 고쳐 주세요.</span>
                  {unsure.length > 0 && (
                    <span className="rounded-[4px] px-1.5 py-px" style={{ background: 'var(--c-yellow-bg)', color: 'var(--c-yellow-text)' }}>
                      확인 필요 {unsure.length}
                    </span>
                  )}
                </div>
                {notice && <p className="mb-3 rounded-[6px] bg-hover px-3 py-2 text-[13px] text-fg2">{notice}</p>}

                <ul className="flex flex-col gap-2.5">
                  {drafts.map((d) => (
                    <DraftCard
                      key={d.key}
                      d={d}
                      problems={problems.get(d.key) ?? {}}
                      duplicate={!!findDuplicate(d, items)}
                      onChange={(patch, field) => update(d.key, patch, field)}
                      onRemove={() => setDrafts((ds) => ds.filter((x) => x.key !== d.key))}
                    />
                  ))}
                </ul>
                <button
                  onClick={() => setDrafts((ds) => [...ds, blankDraft(ds.at(-1)?.date || undefined)])}
                  className="mt-2.5 flex w-full items-center gap-1.5 rounded-[8px] px-3 py-2 text-[14px] text-fg2 hover:bg-hover"
                >
                  <Icon name="plus" size={15} /> 직접 추가
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
              <button onClick={() => setStage('input')} className="flex h-8 items-center gap-1 rounded-[6px] px-2 text-[13px] text-fg2 hover:bg-hover">
                <Icon name="left" size={15} /> 다시 올리기
              </button>
              <div className="flex-1 text-right text-[12px]">
                {broken.length > 0 ? (
                  <span className="text-danger">오류가 있는 항목 {broken.length}개를 고치거나 선택을 해제해 주세요.</span>
                ) : unsure.length > 0 ? (
                  <span style={{ color: 'var(--c-orange-bar)' }}>노란색 칸은 한 번 더 확인해 주세요.</span>
                ) : null}
              </div>
              <button
                onClick={save}
                disabled={!included.length || broken.length > 0}
                className="h-9 rounded-[6px] bg-accent px-4 text-[14px] font-medium text-white hover:brightness-110 disabled:opacity-40"
              >
                선택한 {included.length}개 추가
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function DropZone({ onFiles, fileRef }: { onFiles: (f: File[]) => void; fileRef: React.RefObject<HTMLInputElement | null> }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onClick={() => fileRef.current?.click()}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setOver(false)
        onFiles([...e.dataTransfer.files])
      }}
      className={`flex cursor-pointer flex-col items-center gap-2 rounded-[10px] border-2 border-dashed px-4 py-8 text-center transition-colors ${
        over ? 'border-accent bg-accent-soft' : 'border-line-strong hover:bg-hover'
      }`}
    >
      <Icon name="image" size={28} className="text-fg3" />
      <p className="text-[14px] font-medium">스크린샷·사진·PDF·텍스트 파일을 끌어다 놓거나 클릭해서 선택</p>
      <p className="text-[12px] text-fg2">화면을 캡처한 뒤 Ctrl/⌘ + V 로 바로 붙여넣어도 돼요 · 여러 장 가능</p>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        accept="image/*,application/pdf,.txt,.md,.csv,.ics,text/plain,text/calendar"
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])])
          e.target.value = ''
        }}
      />
    </div>
  )
}

/* ───────── 검토 카드: 모든 칸을 바로 고칠 수 있음 ───────── */
function DraftCard({
  d,
  problems,
  duplicate,
  onChange,
  onRemove,
}: {
  d: Draft
  problems: Problems
  duplicate: boolean
  onChange: (patch: Partial<Draft>, field?: string) => void
  onRemove: () => void
}) {
  const unsure = (f: string) => d.uncertain.includes(f)
  const hasError = Object.keys(problems).length > 0
  return (
    <li
      className={`rounded-[10px] border p-3 transition-opacity ${d.include ? '' : 'opacity-50'} ${
        d.include && hasError ? 'border-danger/60' : d.uncertain.length ? 'border-[var(--c-yellow-bar)]' : 'border-line-strong'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className="pt-[7px]">
          <Checkbox checked={d.include} onChange={(v) => onChange({ include: v })} size={16} label="이 항목 추가" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex shrink-0 rounded-[6px] bg-hover p-0.5">
              {(['event', 'task'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => onChange({ type: t })}
                  className={`rounded-[4px] px-2 py-0.5 text-[12px] ${d.type === t ? 'bg-bg font-medium shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-fg2'}`}
                >
                  {t === 'event' ? '일정' : '할 일'}
                </button>
              ))}
            </div>
            <Field unsure={unsure('title')} error={problems.title} className="min-w-0 flex-1">
              <input
                value={d.title}
                onChange={(e) => onChange({ title: e.target.value }, 'title')}
                placeholder="제목"
                className="w-full bg-transparent px-1.5 py-1 text-[15px] font-semibold outline-none"
              />
            </Field>
            <button onClick={onRemove} className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-fg3 hover:bg-hover hover:text-danger" aria-label="삭제">
              <Icon name="trash" size={14} />
            </button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
            <Labeled label={`날짜${d.date ? ` (${dateLabel(d.date)})` : ''}`}>
              <Field unsure={unsure('date')} error={problems.date}>
                <input type="date" value={d.date} onChange={(e) => onChange({ date: e.target.value }, 'date')} className={inCls} />
              </Field>
            </Labeled>
            <Labeled label="종료일 (여러 날)">
              <Field unsure={unsure('endDate')} error={problems.endDate}>
                <input type="date" value={d.endDate} min={d.date || undefined} onChange={(e) => onChange({ endDate: e.target.value }, 'endDate')} className={inCls} />
              </Field>
            </Labeled>
            <Labeled label="시작 시간">
              <Field unsure={unsure('startTime')} error={problems.startTime}>
                <input type="time" value={d.startTime} onChange={(e) => onChange({ startTime: e.target.value }, 'startTime')} className={inCls} />
              </Field>
            </Labeled>
            <Labeled label="종료 시간">
              <Field unsure={unsure('endTime')} error={problems.endTime}>
                <input type="time" value={d.endTime} onChange={(e) => onChange({ endTime: e.target.value }, 'endTime')} className={inCls} />
              </Field>
            </Labeled>
            <Labeled label="장소" className="col-span-2">
              <Field unsure={unsure('location')}>
                <input value={d.location} onChange={(e) => onChange({ location: e.target.value }, 'location')} placeholder="—" className={inCls} />
              </Field>
            </Labeled>
            <Labeled label="태그 (쉼표로 구분)" className="col-span-2">
              <Field>
                <input value={d.tags} onChange={(e) => onChange({ tags: e.target.value })} placeholder="—" className={inCls} />
              </Field>
            </Labeled>
            <Labeled label="메모" className="col-span-2 sm:col-span-4">
              <Field>
                <textarea value={d.note} onChange={(e) => onChange({ note: e.target.value })} rows={1} placeholder="—" className={`${inCls} resize-y`} />
              </Field>
            </Labeled>
          </div>

          <div className="mt-2 flex flex-col gap-1 text-[12px]">
            {!d.startTime && d.date && (
              <span className="text-fg3">
                {d.type === 'event' ? '시간이 없으면 종일 일정으로 들어가요.' : `${relDay(d.date)} 마감 할 일로 들어가요.`}
              </span>
            )}
            {d.uncertain.length > 0 && (
              <span className="flex items-start gap-1" style={{ color: 'var(--c-orange-bar)' }}>
                <Icon name="alert" size={13} className="mt-px" />
                <span className="flex-1">
                  확인 필요: {d.reason || '글자가 흐리거나 추측한 값이 있어요.'}
                  <button onClick={() => onChange({ uncertain: [] })} className="ml-2 font-medium underline underline-offset-2">
                    맞아요
                  </button>
                </span>
              </span>
            )}
            {duplicate && (
              <span className="flex items-center gap-1 text-fg2">
                <Icon name="done" size={13} /> 같은 날 같은 제목의 항목이 이미 있어서 선택을 해제해 두었어요.
              </span>
            )}
            {d.source && <span className="truncate text-fg3" title={d.source}>원문: “{d.source}”</span>}
          </div>
        </div>
      </div>
    </li>
  )
}

const inCls = 'tnum w-full min-w-0 bg-transparent px-1.5 py-1 text-[13px] outline-none'

function Labeled({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-0.5 ${className}`}>
      <span className="px-0.5 text-[11px] text-fg3">{label}</span>
      {children}
    </label>
  )
}

/** 확인 필요(노랑) / 오류(빨강) 표시를 입히는 칸 */
function Field({ unsure, error, children, className = '' }: { unsure?: boolean; error?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div
        className={`rounded-[6px] border ${error ? 'border-danger' : unsure ? 'border-[var(--c-yellow-bar)]' : 'border-line hover:border-line-strong focus-within:border-accent'}`}
        style={unsure && !error ? { background: 'var(--c-yellow-bg)', color: 'var(--c-yellow-text)' } : undefined}
        title={unsure ? '확인이 필요한 값이에요' : undefined}
      >
        {children}
      </div>
      {error && <p className="mt-0.5 px-0.5 text-[11px] text-danger">{error}</p>}
    </div>
  )
}
