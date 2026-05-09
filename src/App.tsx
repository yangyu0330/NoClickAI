import {
  AlertTriangle,
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  KeyRound,
  ListChecks,
  Loader2,
  Lock,
  MessageSquareText,
  Play,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  Square,
  Users,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'

type Risk = 'low' | 'medium' | 'high' | 'blocked'
type StepStatus = 'ready' | 'needs_approval' | 'approved' | 'running' | 'done' | 'blocked'
type RunPhase = 'draft' | 'approval' | 'running' | 'complete' | 'cancelled'

type Provider = {
  id: string
  name: string
  scope: string
  connected: boolean
}

type PlanStep = {
  id: string
  title: string
  app: string
  detail: string
  preview: string
  risk: Risk
  status: StepStatus
}

type AutomationPlan = {
  id: string
  prompt: string
  title: string
  category: string
  dueLabel: string
  dueIso: string
  clickSavings: number
  timeSavings: number
  apps: string[]
  steps: PlanStep[]
  logs: string[]
  phase: RunPhase
}

const EXAMPLES = [
  '다음주 수요일 4시까지 계획서 제출',
  '다음주 목요일 9시까지 통합회의',
  '이번주 수요일까지 팀원들에게 내가 부여한 과제를 모두 해오도록 다시 공지',
]

const INITIAL_PROVIDERS: Provider[] = [
  { id: 'google-calendar', name: 'Google Calendar', scope: '일정 읽기/쓰기', connected: true },
  { id: 'gmail', name: 'Gmail', scope: '메일 초안 생성', connected: true },
  { id: 'notion', name: 'Notion', scope: '할 일/회의록 작성', connected: false },
  { id: 'slack', name: 'Slack', scope: '채널 메시지 초안', connected: false },
  { id: 'discord', name: 'Discord', scope: '서버 공지 초안', connected: false },
  { id: 'browser', name: 'Browser Agent', scope: '제출 폼 자동 입력', connected: true },
]

const WEEKDAY_INDEX: Record<string, number> = {
  일요일: 0,
  월요일: 1,
  화요일: 2,
  수요일: 3,
  목요일: 4,
  금요일: 5,
  토요일: 6,
}

const RISK_LABEL: Record<Risk, string> = {
  low: '낮음',
  medium: '승인',
  high: '개별 승인',
  blocked: '차단',
}

const STATUS_LABEL: Record<StepStatus, string> = {
  ready: '대기',
  needs_approval: '승인 필요',
  approved: '승인됨',
  running: '실행 중',
  done: '완료',
  blocked: '지원 안 함',
}

const readStoredApiKey = () => {
  if (typeof window === 'undefined') return ''
  return window.localStorage.getItem('noclickai.apiKey') ?? ''
}

const formatKoreanDateTime = (date: Date) =>
  new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  }).format(date)

function cloneDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes())
}

function resolveDateTime(input: string, now = new Date()) {
  const base = cloneDate(now)
  base.setSeconds(0, 0)

  const weekdayName = Object.keys(WEEKDAY_INDEX).find((day) => input.includes(day))
  const targetDay = weekdayName ? WEEKDAY_INDEX[weekdayName] : base.getDay()
  const currentDay = base.getDay()

  let dayOffset = 1
  if (input.includes('다음주') || input.includes('다음 주')) {
    dayOffset = ((targetDay - currentDay + 7) % 7) + 7
  } else if (input.includes('이번주') || input.includes('이번 주')) {
    dayOffset = (targetDay - currentDay + 7) % 7
    if (dayOffset === 0 && base.getHours() >= 18) dayOffset = 7
  } else if (weekdayName) {
    dayOffset = (targetDay - currentDay + 7) % 7
    if (dayOffset === 0) dayOffset = 7
  }

  const timeMatch = input.match(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/)
  const hour = timeMatch ? Number(timeMatch[1]) : input.includes('공지') ? 18 : 9
  const minute = timeMatch?.[2] ? Number(timeMatch[2]) : 0

  const result = cloneDate(base)
  result.setDate(base.getDate() + dayOffset)
  result.setHours(hour, minute, 0, 0)

  return {
    date: result,
    correctedPastThisWeek:
      (input.includes('이번주') || input.includes('이번 주')) && weekdayName !== undefined && dayOffset > 3,
  }
}

function statusForRisk(risk: Risk): StepStatus {
  if (risk === 'low') return 'ready'
  if (risk === 'blocked') return 'blocked'
  return 'needs_approval'
}

function createStep(
  id: string,
  title: string,
  app: string,
  detail: string,
  preview: string,
  risk: Risk,
): PlanStep {
  return {
    id,
    title,
    app,
    detail,
    preview,
    risk,
    status: statusForRisk(risk),
  }
}

function buildPlan(prompt: string): AutomationPlan {
  const normalized = prompt.trim()
  const lower = normalized.toLowerCase()
  const { date, correctedPastThisWeek } = resolveDateTime(normalized)
  const dueLabel = `${formatKoreanDateTime(date)}${correctedPastThisWeek ? ' 보정' : ''}`
  const dueIso = date.toISOString()

  const isMeeting = normalized.includes('회의') || normalized.includes('미팅')
  const isNotice = normalized.includes('공지') || normalized.includes('팀원')
  const isSubmit = normalized.includes('제출') || normalized.includes('계획서') || normalized.includes('과제')
  const isSettlement = normalized.includes('정산') || normalized.includes('영수증')

  if (isMeeting) {
    return {
      id: crypto.randomUUID(),
      prompt: normalized,
      title: '통합회의 일정 조율',
      category: '회의 자동 조율',
      dueLabel,
      dueIso,
      clickSavings: 42,
      timeSavings: 18,
      apps: ['Google Calendar', 'Gmail', 'Slack'],
      phase: 'approval',
      logs: ['목적을 회의 조율 업무로 분류했습니다.', `마감 시각을 ${dueLabel}로 계산했습니다.`],
      steps: [
        createStep(
          'calendar-scan',
          '참석자 일정 후보 확인',
          'Google Calendar',
          '연결된 캘린더에서 비어 있는 후보 시간을 찾습니다.',
          '후보: 09:00, 13:00, 16:00. 충돌 일정은 데모 데이터로 표시합니다.',
          'low',
        ),
        createStep(
          'meeting-draft',
          '회의 공지 초안 작성',
          'Gmail',
          '회의 목적, 시간, 참석 대상이 포함된 초안을 만듭니다.',
          `"통합회의를 ${dueLabel}에 진행합니다. 논의 안건을 확인해 주세요."`,
          'low',
        ),
        createStep(
          'calendar-create',
          '캘린더 일정 등록',
          'Google Calendar',
          '확정된 시간으로 회의 일정을 생성하고 참석자를 초대합니다.',
          `NoClick AI 데모 캘린더에 "통합회의" 일정을 ${dueLabel}로 등록합니다.`,
          'medium',
        ),
        createStep(
          'send-invite',
          '회의 초대 발송',
          'Gmail',
          '작성된 초대를 참석자에게 발송합니다.',
          '실제 MVP에서는 발송 직전 수신자와 본문을 다시 확인합니다. 현재는 발송 준비 완료로 처리합니다.',
          'high',
        ),
      ],
    }
  }

  if (isNotice) {
    return {
      id: crypto.randomUUID(),
      prompt: normalized,
      title: '팀원 과제 재공지',
      category: '공지 자동화',
      dueLabel,
      dueIso,
      clickSavings: 36,
      timeSavings: 14,
      apps: ['Notion', 'Slack', 'Discord'],
      phase: 'approval',
      logs: ['목적을 팀 공지 업무로 분류했습니다.', `공지 마감일을 ${dueLabel}로 계산했습니다.`],
      steps: [
        createStep(
          'task-summary',
          '팀원별 과제 목록 정리',
          'Notion',
          '저장된 팀 과제 목록을 기준으로 담당자와 미완료 항목을 정리합니다.',
          '김민수: 자료 조사, 이지은: 발표 초안, 박도윤: 참고문헌 정리',
          'low',
        ),
        createStep(
          'notice-draft',
          '재공지 메시지 작성',
          'Slack',
          '마감일과 담당 과제를 포함한 공지문을 생성합니다.',
          `팀원 여러분, 각자 맡은 과제를 ${dueLabel}까지 완료해 주세요. 완료 후 자료 링크를 공유해 주세요.`,
          'low',
        ),
        createStep(
          'notion-update',
          '할 일 보드 업데이트',
          'Notion',
          '각 과제 상태를 대기에서 진행 중으로 정리하고 마감일을 반영합니다.',
          'NoClick AI 팀플 보드에 담당자별 마감일을 업데이트합니다.',
          'medium',
        ),
        createStep(
          'post-notice',
          '팀 채널 공지 예약',
          'Discord',
          '선택한 팀 채널에 재공지 메시지를 예약합니다.',
          '현재 데모 모드에서는 즉시 전송하지 않고 공지 예약 로그만 생성합니다.',
          'high',
        ),
      ],
    }
  }

  if (isSettlement) {
    return {
      id: crypto.randomUUID(),
      prompt: normalized,
      title: '영수증 정산 초안',
      category: '정산 준비',
      dueLabel,
      dueIso,
      clickSavings: 31,
      timeSavings: 12,
      apps: ['Gmail', 'Google Drive', 'Browser Agent'],
      phase: 'approval',
      logs: ['목적을 정산 준비 업무로 분류했습니다.', '민감한 송금/결제 단계는 기본 차단합니다.'],
      steps: [
        createStep(
          'receipt-gather',
          '영수증 후보 수집',
          'Gmail',
          '최근 메일과 첨부파일 이름에서 영수증 후보를 찾습니다.',
          '카페_영수증.pdf, 교통비_내역.png, 회의실_대여.pdf',
          'low',
        ),
        createStep(
          'expense-draft',
          '정산표 초안 작성',
          'Google Docs',
          '날짜, 금액, 사용처를 표 형태로 정리합니다.',
          '총 3건, 합계 48,700원. 누락 가능 항목 1건 표시.',
          'low',
        ),
        createStep(
          'form-fill',
          '정산 폼 자동 입력',
          'Browser Agent',
          '정산 사이트 양식에 초안 데이터를 입력합니다.',
          '폼 제출 전 미리보기까지만 진행합니다.',
          'high',
        ),
        createStep(
          'payment',
          '송금 실행',
          'Banking',
          '금융 거래는 MVP 자동화 대상에서 제외됩니다.',
          '결제, 송금, 계정 설정 변경은 NoClick AI가 실행하지 않습니다.',
          'blocked',
        ),
      ],
    }
  }

  return {
    id: crypto.randomUUID(),
    prompt: normalized || '이번 주 할 일 정리',
    title: isSubmit ? '계획서 제출 준비' : lower.includes('mail') ? '메일 답장 준비' : '목적 실행 계획',
    category: isSubmit ? '제출 자동화' : '일반 업무',
    dueLabel,
    dueIso,
    clickSavings: isSubmit ? 39 : 24,
    timeSavings: isSubmit ? 16 : 9,
    apps: isSubmit ? ['Google Drive', 'Gmail', 'Browser Agent'] : ['Calendar', 'Gmail', 'Notion'],
    phase: 'approval',
    logs: ['자연어 목적을 실행 가능한 단계로 분해했습니다.', `목표 시각을 ${dueLabel}로 계산했습니다.`],
    steps: [
      createStep(
        'intent-check',
        isSubmit ? '제출 조건 확인' : '요구사항 정리',
        isSubmit ? 'Google Drive' : 'Notion',
        isSubmit ? '계획서 파일, 제출 위치, 마감 시각을 확인합니다.' : '입력된 요청에서 목표, 일정, 대상자를 추출합니다.',
        isSubmit
          ? `아이디어톤 계획서 파일을 ${dueLabel}까지 제출해야 하는 작업으로 인식했습니다.`
          : `${normalized || '이번 주 할 일'}을 실행 가능한 업무 목록으로 변환했습니다.`,
        'low',
      ),
      createStep(
        'draft-output',
        isSubmit ? '제출 메시지 초안' : '작업 초안 생성',
        'Gmail',
        isSubmit ? '제출 완료 안내 메일 또는 팀 공유 메시지를 준비합니다.' : '사용자 확인용 메시지와 문서 초안을 만듭니다.',
        isSubmit
          ? `"계획서 제출 준비가 완료되었습니다. 최종 파일을 확인한 뒤 제출하겠습니다."`
          : '작업 결과 초안과 확인 항목을 생성합니다.',
        'low',
      ),
      createStep(
        'calendar-reminder',
        '마감 리마인더 등록',
        'Google Calendar',
        '마감 1시간 전 알림을 캘린더에 등록합니다.',
        `${dueLabel} 기준 1시간 전 리마인더를 등록합니다.`,
        'medium',
      ),
      createStep(
        'final-submit',
        isSubmit ? '브라우저 제출 폼 입력' : '외부 앱 최종 실행',
        'Browser Agent',
        isSubmit ? '제출 사이트에서 파일 첨부와 제목 입력을 자동화합니다.' : '외부 서비스의 최종 실행 버튼 직전까지 자동화합니다.',
        'MVP에서는 실제 제출 대신 폼 입력 완료와 최종 승인 요청 로그를 남깁니다.',
        'high',
      ),
    ],
  }
}

function riskIcon(risk: Risk) {
  if (risk === 'low') return <ShieldCheck size={16} />
  if (risk === 'medium') return <CheckCircle2 size={16} />
  if (risk === 'high') return <AlertTriangle size={16} />
  return <Lock size={16} />
}

function App() {
  const [prompt, setPrompt] = useState(EXAMPLES[0])
  const [apiKey, setApiKey] = useState(readStoredApiKey)
  const [apiKeySaved, setApiKeySaved] = useState(() => readStoredApiKey().length > 0)
  const [providers, setProviders] = useState(INITIAL_PROVIDERS)
  const [activePlan, setActivePlan] = useState<AutomationPlan>(() => buildPlan(EXAMPLES[0]))
  const [history, setHistory] = useState<AutomationPlan[]>([])

  useEffect(() => {
    if (activePlan.phase !== 'running') return

    const executable = activePlan.steps.filter((step) => step.status !== 'done' && step.status !== 'blocked')
    if (executable.length === 0) {
      const timer = window.setTimeout(() => {
        const completedPlan = {
          ...activePlan,
          phase: 'complete' as RunPhase,
          logs: [...activePlan.logs, '모든 승인된 작업을 완료했습니다.'],
        }
        setActivePlan(completedPlan)
        setHistory((items) => [completedPlan, ...items.filter((item) => item.id !== completedPlan.id)].slice(0, 6))
      }, 0)
      return () => window.clearTimeout(timer)
    }

    const next = executable[0]
    const timer = window.setTimeout(() => {
      setActivePlan((current) => {
        if (current.phase !== 'running') return current
        const currentStep = current.steps.find((step) => step.id === next.id)
        if (!currentStep) return current

        if (currentStep.status === 'ready' || currentStep.status === 'approved') {
          return {
            ...current,
            steps: current.steps.map((step) =>
              step.id === currentStep.id ? { ...step, status: 'running' } : step,
            ),
            logs: [...current.logs, `${currentStep.app}: ${currentStep.title} 실행을 시작했습니다.`],
          }
        }

        if (currentStep.status === 'running') {
          return {
            ...current,
            steps: current.steps.map((step) =>
              step.id === currentStep.id ? { ...step, status: 'done' } : step,
            ),
            logs: [...current.logs, `${currentStep.app}: ${currentStep.title} 완료.`],
          }
        }

        return current
      })
    }, 850)

    return () => window.clearTimeout(timer)
  }, [activePlan])

  const approvalCount = useMemo(
    () => activePlan.steps.filter((step) => step.status === 'needs_approval').length,
    [activePlan.steps],
  )

  const activeLogIndex = Math.max(activePlan.logs.length - 1, 0)

  const completedCount = useMemo(
    () => activePlan.steps.filter((step) => step.status === 'done' || step.status === 'blocked').length,
    [activePlan.steps],
  )

  const progress = Math.round((completedCount / activePlan.steps.length) * 100)

  const saveApiKey = () => {
    if (apiKey.trim()) {
      window.localStorage.setItem('noclickai.apiKey', apiKey.trim())
      setApiKeySaved(true)
    }
  }

  const clearApiKey = () => {
    window.localStorage.removeItem('noclickai.apiKey')
    setApiKey('')
    setApiKeySaved(false)
  }

  const generatePlan = (nextPrompt = prompt) => {
    const plan = buildPlan(nextPrompt)
    setPrompt(nextPrompt)
    setActivePlan(plan)
  }

  const approveStep = (stepId: string) => {
    setActivePlan((plan) => ({
      ...plan,
      steps: plan.steps.map((step) => (step.id === stepId ? { ...step, status: 'approved' } : step)),
      logs: [...plan.logs, '사용자가 개별 단계를 승인했습니다.'],
    }))
  }

  const approveMediumRisk = () => {
    setActivePlan((plan) => ({
      ...plan,
      steps: plan.steps.map((step) =>
        step.risk === 'medium' && step.status === 'needs_approval' ? { ...step, status: 'approved' } : step,
      ),
      logs: [...plan.logs, '중간 위험 단계가 일괄 승인되었습니다.'],
    }))
  }

  const approveAllAvailable = () => {
    setActivePlan((plan) => ({
      ...plan,
      steps: plan.steps.map((step) =>
        step.status === 'needs_approval' && step.risk !== 'blocked' ? { ...step, status: 'approved' } : step,
      ),
      logs: [...plan.logs, '모든 승인 가능 단계가 승인되었습니다.'],
    }))
  }

  const startExecution = () => {
    if (approvalCount > 0) return
    setActivePlan((plan) => ({
      ...plan,
      phase: 'running',
      logs: [...plan.logs, '승인된 자동 실행을 시작합니다. 외부 API는 데모 모드로 시뮬레이션합니다.'],
    }))
  }

  const cancelPlan = () => {
    setActivePlan((plan) => ({
      ...plan,
      phase: 'cancelled',
      logs: [...plan.logs, '사용자가 실행을 취소했습니다.'],
    }))
  }

  const resetPlan = () => {
    setActivePlan(buildPlan(prompt))
  }

  const toggleProvider = (id: string) => {
    setProviders((items) =>
      items.map((provider) =>
        provider.id === id ? { ...provider, connected: !provider.connected } : provider,
      ),
    )
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            NC
          </div>
          <div>
            <h1>NoClick AI</h1>
            <p>목적 입력형 자동 실행 MVP</p>
          </div>
        </div>
        <div className="device-strip" aria-label="지원 환경">
          <span>
            <Smartphone size={16} /> Android
          </span>
          <span>
            <Square size={16} /> Desktop
          </span>
        </div>
      </header>

      <section className="workspace">
        <aside className="control-panel" aria-label="작업 입력">
          <div className="panel-block">
            <div className="section-title">
              <MessageSquareText size={18} />
              <h2>목적</h2>
            </div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={5}
              aria-label="자연어 목적 입력"
            />
            <button className="primary-button" type="button" onClick={() => generatePlan()}>
              <Play size={18} /> 계획 생성
            </button>
            <div className="example-grid">
              {EXAMPLES.map((example) => (
                <button type="button" key={example} onClick={() => generatePlan(example)}>
                  {example}
                </button>
              ))}
            </div>
          </div>

          <div className="panel-block compact">
            <div className="section-title">
              <KeyRound size={18} />
              <h2>개인 API Key</h2>
            </div>
            <div className="key-row">
              <input
                type="password"
                value={apiKey}
                onChange={(event) => {
                  setApiKey(event.target.value)
                  setApiKeySaved(false)
                }}
                placeholder="sk-..."
                aria-label="개인 API Key"
              />
              <button type="button" onClick={saveApiKey}>
                저장
              </button>
            </div>
            <div className="status-line">
              <span className={apiKeySaved ? 'dot connected' : 'dot'} />
              {apiKeySaved ? '로컬 브라우저에 저장됨' : '데모 플래너 사용 중'}
              {apiKeySaved && (
                <button type="button" className="link-button" onClick={clearApiKey}>
                  삭제
                </button>
              )}
            </div>
          </div>

          <div className="panel-block compact">
            <div className="section-title">
              <Lock size={18} />
              <h2>OAuth 연결</h2>
            </div>
            <div className="provider-list">
              {providers.map((provider) => (
                <button
                  type="button"
                  className={provider.connected ? 'provider connected' : 'provider'}
                  key={provider.id}
                  onClick={() => toggleProvider(provider.id)}
                >
                  <span>
                    <strong>{provider.name}</strong>
                    <small>{provider.scope}</small>
                  </span>
                  <span>{provider.connected ? '연결' : '미연결'}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section className="execution-panel" aria-label="실행 계획">
          <div className="summary-band">
            <div>
              <span className="eyebrow">{activePlan.category}</span>
              <h2>{activePlan.title}</h2>
              <p>{activePlan.prompt}</p>
            </div>
            <div className="metric-row" aria-label="자동화 지표">
              <div>
                <strong>{activePlan.clickSavings}</strong>
                <span>절감 클릭</span>
              </div>
              <div>
                <strong>{activePlan.timeSavings}분</strong>
                <span>예상 절감</span>
              </div>
              <div>
                <strong>{progress}%</strong>
                <span>진행률</span>
              </div>
            </div>
          </div>

          <div className="plan-meta">
            <span>
              <Clock3 size={16} /> {activePlan.dueLabel}
            </span>
            <span>
              <CalendarDays size={16} /> {activePlan.apps.join(', ')}
            </span>
            <span>
              <ShieldCheck size={16} /> 위험도별 승인
            </span>
          </div>

          <div className="timeline" aria-label="실행 단계">
            {activePlan.steps.map((step, index) => (
              <article className={`step-card risk-${step.risk}`} key={step.id}>
                <div className="step-index">{index + 1}</div>
                <div className="step-content">
                  <div className="step-heading">
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.app}</p>
                    </div>
                    <span className={`risk-pill ${step.risk}`}>
                      {riskIcon(step.risk)}
                      {RISK_LABEL[step.risk]}
                    </span>
                  </div>
                  <p>{step.detail}</p>
                  <div className="preview-box">
                    <FileText size={16} />
                    <span>{step.preview}</span>
                  </div>
                  <div className="step-actions">
                    <span className={`status status-${step.status}`}>
                      {step.status === 'running' && <Loader2 size={14} className="spin" />}
                      {STATUS_LABEL[step.status]}
                    </span>
                    {step.status === 'needs_approval' && (
                      <button type="button" onClick={() => approveStep(step.id)}>
                        승인 <ChevronRight size={16} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <aside className="ops-panel" aria-label="승인과 로그">
          <div className="approval-box">
            <div className="section-title">
              <ListChecks size={18} />
              <h2>승인</h2>
            </div>
            <div className="approval-stats">
              <span>{approvalCount}개 대기</span>
              <span>{activePlan.phase}</span>
            </div>
            <button type="button" onClick={approveMediumRisk} disabled={approvalCount === 0}>
              중간 위험 승인
            </button>
            <button type="button" onClick={approveAllAvailable} disabled={approvalCount === 0}>
              모든 승인 가능 단계 승인
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={startExecution}
              disabled={approvalCount > 0 || activePlan.phase === 'running' || activePlan.phase === 'complete'}
            >
              <Play size={18} /> 실행
            </button>
            <button type="button" onClick={cancelPlan} disabled={activePlan.phase === 'complete'}>
              취소
            </button>
            <button type="button" onClick={resetPlan}>
              <RefreshCcw size={18} /> 초기화
            </button>
          </div>

          <div className="log-box">
            <div className="section-title">
              <Bell size={18} />
              <h2>실행 로그</h2>
            </div>
            <ol>
              {activePlan.logs.map((log, index) => (
                <li className={index === activeLogIndex ? 'active' : ''} key={`${log}-${index}`}>
                  {log}
                </li>
              ))}
            </ol>
          </div>

          <div className="history-box">
            <div className="section-title">
              <Users size={18} />
              <h2>히스토리</h2>
            </div>
            {history.length === 0 ? (
              <p className="empty-text">완료된 실행이 없습니다.</p>
            ) : (
              <div className="history-list">
                {history.map((item) => (
                  <button type="button" key={item.id} onClick={() => setActivePlan(item)}>
                    <strong>{item.title}</strong>
                    <span>{item.dueLabel}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </section>
    </main>
  )
}

export default App
