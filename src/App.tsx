import {
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Cloud,
  CreditCard,
  KeyRound,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Play,
  RefreshCcw,
  Send,
  Settings,
  ShieldCheck,
  Smartphone,
  Trash2,
  Unlink,
  UserPlus,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import './App.css'

type AccountUser = {
  id: string
  email: string
  name: string
  role?: string
  isAdmin?: boolean
  subscriptionStatus: string
  billingPlan: string
  createdAt: string
}

type AuthSession = {
  token: string
  user: AccountUser
}

type ConnectorStatus = {
  id: string
  name: string
  provider: string
  type: string
  actions: string[]
  configured: boolean
  connected: boolean
  needsOAuth: boolean
  redirectUri?: string
  scopes?: string[]
  missingConfig?: string[]
}

type StepStatus = 'ready' | 'needs_approval' | 'approved' | 'running' | 'done' | 'failed' | 'blocked'
type Risk = 'low' | 'medium' | 'high' | 'blocked'

type RunStep = {
  id: string
  title: string
  provider: string
  action: string
  detail: string
  preview: string
  risk: Risk
  status: StepStatus
  result?: {
    ok?: boolean
    code?: string
    message?: string
    link?: string
    externalId?: string
    shareText?: string
  } | null
}

type AutomationRun = {
  id: string
  prompt: string
  status: string
  assistantMessage: string
  steps: RunStep[]
  createdAt: string
  updatedAt: string
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  createdAt: string
}

type BillingStatus = {
  stripeConfigured: boolean
  checkoutReady: boolean
  portalReady: boolean
  user: AccountUser
}

type AuditStep = {
  stepId: string
  provider: string
  action: string
  title: string
  risk: Risk
  status: StepStatus
  to?: string
  subject?: string
}

type AuditLog = {
  id: string
  userId: string
  type: string
  runId: string
  createdAt: string
  step?: AuditStep
  steps?: AuditStep[]
  result?: {
    ok?: boolean
    code?: string
    message?: string
    externalId?: string
    threadId?: string
    link?: string
  }
}

type ReadinessStatus = 'ready' | 'missing' | 'warning' | 'manual'

type ReadinessItem = {
  id: string
  category: string
  label: string
  status: ReadinessStatus
  detail: string
  action: string
}

type ReadinessReport = {
  ok: boolean
  productionReady: boolean
  generatedAt: string
  publicAppUrl: string
  serverBaseUrl: string
  release?: {
    tag: string
    pageUrl: string
    downloadsUrl: string
    assets: {
      id: string
      label: string
      fileName: string
      url: string
    }[]
  }
  summary: {
    ready: number
    missing: number
    warning: number
    manual: number
    total: number
  }
  items: ReadinessItem[]
}

const STORAGE_KEYS = {
  authSession: 'noclickai.authSession',
  endpoint: 'noclickai.endpoint',
  chatMessages: 'noclickai.chatMessages',
  activeRun: 'noclickai.activeRun',
}

const PACKAGED_APP_ENDPOINT = (import.meta.env.VITE_NOCLICK_SERVER_BASE_URL || 'https://noclickai-zeta.vercel.app').replace(
  /\/+$/,
  '',
)

function detectDefaultEndpoint() {
  if (typeof window === 'undefined') return PACKAGED_APP_ENDPOINT
  if (window.location.port === '5173') return 'http://127.0.0.1:8788'
  if (window.location.protocol === 'file:') return PACKAGED_APP_ENDPOINT
  if (window.location.protocol === 'https:' && window.location.hostname === 'localhost' && !window.location.port) {
    return PACKAGED_APP_ENDPOINT
  }
  return window.location.origin
}

const DEFAULT_ENDPOINT = detectDefaultEndpoint()

const QUICK_PROMPTS = [
  '내일 오전 10시에 회의 잡고 참석자에게 메일 검토 초안 준비해줘',
  '이번주 팀 과제 현황을 Notion에 정리하고 Slack 공지 초안 만들어줘',
  '다음주 수요일까지 제출할 계획서 준비하고 마감 알림 등록해줘',
]

const PROVIDER_LABEL: Record<string, string> = {
  'google-calendar': 'Calendar',
  gmail: 'Gmail',
  notion: 'Notion',
  slack: 'Slack',
  telegram: 'Telegram',
  kakao: 'KakaoTalk',
}

const STATUS_LABEL: Record<StepStatus, string> = {
  ready: '준비',
  needs_approval: '승인 필요',
  approved: '승인됨',
  running: '실행 중',
  done: '완료',
  failed: '실패',
  blocked: '차단',
}

const LEGAL_UPDATED_AT = '2026-05-11'

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJsonStorage(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value))
}

function normalizeEndpoint(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '')
}

function newMessage(role: ChatMessage['role'], text: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    text,
    createdAt: new Date().toISOString(),
  }
}

function connectorCopy(connector: ConnectorStatus) {
  if (!connector.configured && connector.missingConfig?.length) return `${connector.missingConfig.join(', ')} 필요`
  if (!connector.configured) return '서버 설정 필요'
  if (connector.type === 'share' || connector.type === 'bot_or_share' || connector.type === 'oauth_or_share') return '공유 fallback 준비됨'
  if (connector.connected) return '연결됨'
  if (connector.id === 'telegram') return 'Bot 설정 필요'
  return '연결 필요'
}

function statusTone(status: StepStatus) {
  if (status === 'done') return 'good'
  if (status === 'failed' || status === 'blocked') return 'bad'
  if (status === 'needs_approval') return 'warn'
  return 'neutral'
}

function highRiskExecutableSteps(run: AutomationRun | null) {
  return (
    run?.steps.filter(
      (step) =>
        step.risk === 'high' &&
        step.status !== 'needs_approval' &&
        step.status !== 'done' &&
        step.status !== 'failed' &&
        step.status !== 'blocked',
    ) ?? []
  )
}

function auditLabel(log: AuditLog) {
  if (log.type === 'steps_approved') return '승인'
  if (log.type === 'step_executed') return log.result?.ok ? '실행 완료' : '실행 실패'
  return log.type
}

function readinessTone(status: ReadinessStatus) {
  if (status === 'ready') return 'good'
  if (status === 'missing') return 'bad'
  if (status === 'warning') return 'warn'
  return 'neutral'
}

function readinessLabel(status: ReadinessStatus) {
  if (status === 'ready') return '준비'
  if (status === 'missing') return '누락'
  if (status === 'warning') return '주의'
  return '수동'
}

function LegalPage({ kind }: { kind: 'privacy' | 'terms' }) {
  const isPrivacy = kind === 'privacy'
  return (
    <main className="legal-shell">
      <section className="legal-panel">
        <a className="legal-back" href="/">
          NoClick AI
        </a>
        <h1>{isPrivacy ? 'Privacy Policy' : 'Terms of Service'}</h1>
        <p className="legal-date">Last updated: {LEGAL_UPDATED_AT}</p>
        {isPrivacy ? (
          <>
            <h2>Overview</h2>
            <p>
              NoClick AI is an automation assistant that turns user instructions into reviewed actions across connected services such as Google Calendar and Gmail.
            </p>
            <h2>Information We Process</h2>
            <p>
              We process account email addresses, session tokens, automation prompts, run history, audit logs, connector status, and OAuth tokens needed to perform approved actions.
            </p>
            <h2>Google User Data</h2>
            <p>
              When you connect Google, NoClick AI requests access only for the features shown in the app: creating Calendar events, preparing email review drafts inside NoClick AI, sending approved Gmail messages, and reading the Google account email used for the connection.
            </p>
            <p>
              The public default Gmail connection uses the Gmail send-only scope for approved sends. If an operator enables optional Gmail draft mode, NoClick AI may request the Gmail compose scope to create Gmail drafts.
            </p>
            <p>
              Google OAuth tokens are encrypted before storage. Google user data is used only to provide or improve user-facing automation features, is not sold, is not used for advertising, and is not used to train generalized AI models.
            </p>
            <p>
              NoClick AI's use and transfer of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.
            </p>
            <h2>Data Sharing</h2>
            <p>
              We send data to connected services only when needed to complete user-approved actions. We also use infrastructure providers such as Vercel, Neon Postgres, OpenAI, and Stripe when those services are configured for hosting, storage, AI planning, and billing.
            </p>
            <h2>Retention and Deletion</h2>
            <p>
              Automation history and audit logs are retained to help users review approvals and external actions. Users can disconnect providers from the app to stop new access. Administrators can delete stored account data, OAuth tokens, run history, and audit logs on request.
            </p>
            <p>
              Users can also delete their own NoClick AI account and stored data from the app. Public deletion instructions are available at <a href="/data-deletion">/data-deletion</a>.
            </p>
            <h2>Contact</h2>
            <p>For privacy requests, contact the NoClick AI operator at the support address listed in the Google OAuth consent screen.</p>
          </>
        ) : (
          <>
            <h2>Use of the Service</h2>
            <p>
              NoClick AI helps users plan, approve, and execute automations. You are responsible for reviewing each action before approving execution, especially messages, emails, calendar changes, and third-party service updates.
            </p>
            <h2>Connected Accounts</h2>
            <p>
              You must only connect accounts that you own or are authorized to use. Disconnecting a provider stops new actions from using that provider.
            </p>
            <h2>High-Risk Actions</h2>
            <p>
              External sends and similar high-risk actions require approval and confirmation. You remain responsible for the content and destination of any message or email you approve.
            </p>
            <h2>Availability</h2>
            <p>
              The service depends on third-party APIs and may be interrupted by provider outages, revoked permissions, rate limits, billing configuration, or policy restrictions.
            </p>
            <h2>Limitations</h2>
            <p>
              NoClick AI is provided as an automation tool without a guarantee that every generated plan is correct. Review plans and outputs before execution.
            </p>
            <h2>Contact</h2>
            <p>For service questions, contact the NoClick AI operator at the support address listed in the Google OAuth consent screen.</p>
          </>
        )}
      </section>
    </main>
  )
}

function AppShell() {
  const [endpoint, setEndpoint] = useState(() => window.localStorage.getItem(STORAGE_KEYS.endpoint) || DEFAULT_ENDPOINT)
  const [authSession, setAuthSession] = useState<AuthSession | null>(() =>
    readJsonStorage<AuthSession | null>(STORAGE_KEYS.authSession, null),
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accountStatus, setAccountStatus] = useState('로그인 전')
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null)
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [readiness, setReadiness] = useState<ReadinessReport | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    readJsonStorage<ChatMessage[]>(STORAGE_KEYS.chatMessages, [
      newMessage(
        'assistant',
        '무엇을 자동화할까요? 일정, 메일 검토 초안, Notion 페이지, Slack 공지, Telegram 메시지를 한 문장으로 요청하세요.',
      ),
    ]),
  )
  const [activeRun, setActiveRun] = useState<AutomationRun | null>(() =>
    readJsonStorage<AutomationRun | null>(STORAGE_KEYS.activeRun, null),
  )
  const [input, setInput] = useState('')
  const [isBusy, setIsBusy] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const chatEndRef = useRef<HTMLDivElement | null>(null)
  const authToken = authSession?.token ?? ''

  const pendingApprovals = useMemo(
    () => activeRun?.steps.filter((step) => step.status === 'needs_approval').length ?? 0,
    [activeRun],
  )

  const connectedCount = useMemo(() => connectors.filter((connector) => connector.connected).length, [connectors])
  const isAdminUser = Boolean(authSession?.user.isAdmin || authSession?.user.billingPlan === 'admin')

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.endpoint, endpoint)
  }, [endpoint])

  useEffect(() => {
    if (authSession) writeJsonStorage(STORAGE_KEYS.authSession, authSession)
    else window.localStorage.removeItem(STORAGE_KEYS.authSession)
  }, [authSession])

  useEffect(() => {
    writeJsonStorage(STORAGE_KEYS.chatMessages, messages.slice(-80))
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  useEffect(() => {
    if (activeRun) writeJsonStorage(STORAGE_KEYS.activeRun, activeRun)
    else window.localStorage.removeItem(STORAGE_KEYS.activeRun)
  }, [activeRun])

  const apiFetch = async (path: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers)
    if (authSession?.token) headers.set('Authorization', `Bearer ${authSession.token}`)
    if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

    const response = await fetch(`${normalizeEndpoint(endpoint)}${path}`, {
      ...options,
      headers,
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.detail || body.error || `HTTP ${response.status}`)
    return body
  }

  const refreshConnectors = async () => {
    if (!authSession) return
    const body = await apiFetch('/v1/connectors')
    setConnectors(body.connectors ?? [])
  }

  const refreshBilling = async () => {
    if (!authSession) return
    const body = (await apiFetch('/v1/billing/status')) as BillingStatus
    setBillingStatus(body)
    setAuthSession((current) => (current ? { ...current, user: body.user } : current))
  }

  const refreshAuditLogs = async () => {
    if (!authSession) return
    const body = await apiFetch('/v1/runs/audit-logs')
    setAuditLogs(body.auditLogs ?? [])
  }

  const refreshReadiness = async () => {
    if (!authSession) return
    const body = (await apiFetch('/v1/readiness')) as ReadinessReport
    setReadiness(body)
  }

  useEffect(() => {
    if (!authToken) return
    const baseUrl = normalizeEndpoint(endpoint)
    const headers = { Authorization: `Bearer ${authToken}` }

    void fetch(`${baseUrl}/v1/connectors`, { headers })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
        setConnectors(body.connectors ?? [])
      })
      .catch((error) => setAccountStatus(`커넥터 확인 실패: ${error.message}`))

    void fetch(`${baseUrl}/v1/billing/status`, { headers })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
        setBillingStatus(body as BillingStatus)
      })
      .catch(() => undefined)

    void fetch(`${baseUrl}/v1/runs/audit-logs`, { headers })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
        setAuditLogs(body.auditLogs ?? [])
      })
      .catch(() => undefined)

    void fetch(`${baseUrl}/v1/readiness`, { headers })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
        setReadiness(body as ReadinessReport)
      })
      .catch(() => undefined)
  }, [authToken, endpoint])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const connector = params.get('connector')
    const status = params.get('status')
    if (!connector || !status) return

    setMessages((items) => [
      ...items,
      newMessage('system', `${PROVIDER_LABEL[connector] || connector} 연결 결과: ${status}`),
    ])
    window.history.replaceState({}, '', window.location.pathname)
    if (!authToken) return
    const headers = { Authorization: `Bearer ${authToken}` }
    void fetch(`${normalizeEndpoint(endpoint)}/v1/connectors`, { headers })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
        setConnectors(body.connectors ?? [])
      })
      .catch(() => undefined)
  }, [authToken, endpoint])

  const submitAccount = async (mode: 'login' | 'register') => {
    setIsBusy(true)
    setAccountStatus(mode === 'login' ? '로그인 중...' : '가입 중...')
    try {
      const body = (await apiFetch(`/v1/auth/${mode}`, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })) as AuthSession
      setAuthSession(body)
      setPassword('')
      setAccountStatus(mode === 'login' ? '로그인 완료' : '가입 완료')
      setMessages((items) => [...items, newMessage('system', `${body.user.email} 계정으로 연결되었습니다.`)])
    } catch (error) {
      setAccountStatus(error instanceof Error ? error.message : '계정 처리 실패')
    } finally {
      setIsBusy(false)
    }
  }

  const logout = async () => {
    await apiFetch('/v1/auth/logout', { method: 'POST' }).catch(() => undefined)
    setAuthSession(null)
    setBillingStatus(null)
    setConnectors([])
    setAuditLogs([])
    setReadiness(null)
    setAccountStatus('로그아웃 완료')
  }

  const deleteAccount = async () => {
    if (!authSession) return
    const confirmEmail = window.prompt(`계정과 저장 데이터를 삭제하려면 이메일을 입력하세요: ${authSession.user.email}`)
    if (confirmEmail !== authSession.user.email) {
      setAccountStatus('계정 삭제 취소됨')
      return
    }

    setIsBusy(true)
    try {
      await apiFetch('/v1/auth/delete-account', {
        method: 'POST',
        body: JSON.stringify({ confirmEmail }),
      })
      window.localStorage.removeItem(STORAGE_KEYS.authSession)
      window.localStorage.removeItem(STORAGE_KEYS.activeRun)
      window.localStorage.removeItem(STORAGE_KEYS.chatMessages)
      setAuthSession(null)
      setBillingStatus(null)
      setConnectors([])
      setAuditLogs([])
      setReadiness(null)
      setActiveRun(null)
      setMessages([newMessage('system', '계정과 저장 데이터가 삭제되었습니다.')])
      setAccountStatus('계정 삭제 완료')
    } catch (error) {
      setAccountStatus(error instanceof Error ? `계정 삭제 실패: ${error.message}` : '계정 삭제 실패')
    } finally {
      setIsBusy(false)
    }
  }

  const startCheckout = async () => {
    setIsBusy(true)
    try {
      const body = await apiFetch('/v1/billing/checkout', { method: 'POST' })
      window.location.href = body.url
    } catch (error) {
      setAccountStatus(error instanceof Error ? `결제 실패: ${error.message}` : '결제 실패')
    } finally {
      setIsBusy(false)
    }
  }

  const openPortal = async () => {
    setIsBusy(true)
    try {
      const body = await apiFetch('/v1/billing/portal', { method: 'POST' })
      window.location.href = body.url
    } catch (error) {
      setAccountStatus(error instanceof Error ? `구독 관리 실패: ${error.message}` : '구독 관리 실패')
    } finally {
      setIsBusy(false)
    }
  }

  const connectProvider = async (connector: ConnectorStatus) => {
    if ((connector.type === 'share' || connector.type === 'bot_or_share' || connector.type === 'oauth_or_share') && !connector.needsOAuth) {
      setMessages((items) => [
        ...items,
        newMessage('assistant', `${connector.name}은 계정 연결 없이 실행 결과의 공유 버튼으로 Android 공유창이나 클립보드 fallback을 사용합니다.`),
      ])
      return
    }
    if (connector.id === 'telegram') {
      setMessages((items) => [
        ...items,
        newMessage('assistant', 'Telegram은 서버 .env에 TELEGRAM_BOT_TOKEN과 TELEGRAM_DEFAULT_CHAT_ID를 설정해야 합니다.'),
      ])
      return
    }
    if (!connector.configured) {
      const missing = connector.missingConfig?.length ? connector.missingConfig.join(', ') : 'OAuth Client ID/Secret'
      const redirect = connector.redirectUri ? `\nRedirect URI: ${connector.redirectUri}` : ''
      setMessages((items) => [
        ...items,
        newMessage('assistant', `${connector.name} 설정이 필요합니다. Vercel에 ${missing} 값을 넣어주세요.${redirect}`),
      ])
      return
    }

    const body = await apiFetch(`/v1/connectors/${connector.id}/start`)
    window.location.href = body.url
  }

  const disconnectProvider = async (connector: ConnectorStatus) => {
    const body = await apiFetch(`/v1/connectors/${connector.id}/disconnect`, { method: 'POST' })
    setConnectors(body.connectors ?? [])
  }

  const sendChat = async (text = input.trim()) => {
    const message = text.trim()
    if (!message || isBusy) return
    if (!authSession) {
      setMessages((items) => [...items, newMessage('user', message), newMessage('assistant', '먼저 로그인하거나 가입해 주세요.')])
      setInput('')
      return
    }

    setIsBusy(true)
    setInput('')
    setMessages((items) => [...items, newMessage('user', message)])
    try {
      const body = await apiFetch('/v1/chat', {
        method: 'POST',
        body: JSON.stringify({ message, runId: activeRun?.id }),
      })
      setActiveRun(body.run)
      if (body.connectors) setConnectors(body.connectors)
      setMessages((items) => [...items, newMessage('assistant', body.assistantMessage || body.run?.assistantMessage)])
    } catch (error) {
      setMessages((items) => [
        ...items,
        newMessage('assistant', error instanceof Error ? `처리 실패: ${error.message}` : '처리 실패'),
      ])
    } finally {
      setIsBusy(false)
    }
  }

  const approveRun = async () => {
    if (!activeRun) return
    setIsBusy(true)
    try {
      const body = await apiFetch(`/v1/runs/${activeRun.id}/approve`, { method: 'POST', body: JSON.stringify({}) })
      setActiveRun(body.run)
      await refreshAuditLogs().catch(() => undefined)
      setMessages((items) => [...items, newMessage('assistant', '승인 가능한 단계를 승인했습니다.')])
    } catch (error) {
      setMessages((items) => [
        ...items,
        newMessage('assistant', error instanceof Error ? `승인 실패: ${error.message}` : '승인 실패'),
      ])
    } finally {
      setIsBusy(false)
    }
  }

  const executeRun = async () => {
    if (!activeRun) return
    const highRiskSteps = highRiskExecutableSteps(activeRun)
    if (highRiskSteps.length) {
      const summary = highRiskSteps
        .map((step) => `${step.title} / ${PROVIDER_LABEL[step.provider] || step.provider} / ${step.action}`)
        .join('\n')
      const confirmed = window.confirm(`실제 외부 전송 작업입니다.\n\n${summary}\n\n승인된 내용을 지금 실행할까요?`)
      if (!confirmed) return
    }
    setIsBusy(true)
    try {
      const body = await apiFetch(`/v1/runs/${activeRun.id}/execute`, {
        method: 'POST',
        body: JSON.stringify({ confirmHighRisk: highRiskSteps.length > 0 }),
      })
      setActiveRun(body.run)
      setMessages((items) => [...items, newMessage('assistant', '승인된 단계를 실행했습니다. 결과를 오른쪽에서 확인하세요.')])
      await refreshConnectors().catch(() => undefined)
      await refreshAuditLogs().catch(() => undefined)
    } catch (error) {
      setMessages((items) => [
        ...items,
        newMessage('assistant', error instanceof Error ? `실행 실패: ${error.message}` : '실행 실패'),
      ])
    } finally {
      setIsBusy(false)
    }
  }

  const copyShareText = async (text: string) => {
    if (navigator.share) {
      await navigator.share({ text }).catch(() => undefined)
      return
    }
    await navigator.clipboard.writeText(text)
    setMessages((items) => [...items, newMessage('system', '공유할 텍스트를 클립보드에 복사했습니다.')])
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void sendChat()
    }
  }

  const handleAccountSubmit = (event: FormEvent) => {
    event.preventDefault()
    void submitAccount('login')
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
            <p>채팅만으로 계획, 승인, 실행</p>
          </div>
        </div>
        <div className="top-actions">
          <span className="chip">
            <Bot size={15} /> {authSession ? '로그인됨' : '로그인 필요'}
          </span>
          <span className="chip">
            <Cloud size={15} /> {connectedCount}/{connectors.length || 6} 연결
          </span>
          <button type="button" className="icon-button" onClick={() => setShowSettings((value) => !value)}>
            <Settings size={18} />
          </button>
        </div>
      </header>

      <section className="chat-layout">
        <section className="chat-panel" aria-label="NoClick AI 채팅">
          <div className="chat-stream">
            {messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <div className="message-role">{message.role === 'user' ? 'You' : message.role === 'system' ? 'System' : 'NoClick'}</div>
                <p>{message.text}</p>
              </article>
            ))}
            {isBusy && (
              <article className="message assistant">
                <div className="message-role">NoClick</div>
                <p>
                  <Loader2 className="spin" size={16} /> 처리 중...
                </p>
              </article>
            )}
            <div ref={chatEndRef} />
          </div>

          <div className="quick-row">
            {QUICK_PROMPTS.map((prompt) => (
              <button type="button" key={prompt} onClick={() => void sendChat(prompt)} disabled={isBusy}>
                {prompt}
              </button>
            ))}
          </div>

          <div className="composer">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="예: 내일 오전 10시에 회의 잡고 참석자에게 메일 검토 초안 준비해줘"
              aria-label="자동화 요청"
            />
            <button type="button" className="send-button" onClick={() => void sendChat()} disabled={isBusy || !input.trim()}>
              <Send size={18} /> 보내기
            </button>
          </div>
        </section>

        <aside className="side-panel" aria-label="계정, 연결, 실행 상태">
          <section className="panel-card">
            <div className="section-title">
              <KeyRound size={18} />
              <h2>계정</h2>
            </div>
            {authSession ? (
              <>
                <div className="account-card">
                  <strong>{authSession.user.email}</strong>
                  <span>
                    {isAdminUser ? 'Admin' : authSession.user.billingPlan === 'pro' ? 'Pro' : 'Free'} /{' '}
                    {authSession.user.subscriptionStatus}
                  </span>
                </div>
                <div className="button-grid">
                  <button type="button" onClick={() => void refreshBilling()} disabled={isBusy}>
                    <RefreshCcw size={16} /> 상태
                  </button>
                  <button type="button" onClick={() => void startCheckout()} disabled={isBusy || isAdminUser}>
                    <CreditCard size={16} /> 구독
                  </button>
                  <button type="button" onClick={() => void openPortal()} disabled={isBusy || isAdminUser || !(billingStatus?.portalReady ?? false)}>
                    <CreditCard size={16} /> 관리
                  </button>
                  <button type="button" onClick={() => void logout()} disabled={isBusy}>
                    <LogOut size={16} /> 로그아웃
                  </button>
                  <button type="button" className="danger-button" onClick={() => void deleteAccount()} disabled={isBusy}>
                    <Trash2 size={16} /> 계정 삭제
                  </button>
                </div>
              </>
            ) : (
              <form className="account-form" onSubmit={handleAccountSubmit}>
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="email@example.com"
                  aria-label="이메일"
                />
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="비밀번호 8자 이상"
                  aria-label="비밀번호"
                />
                <div className="button-grid">
                  <button type="submit" disabled={isBusy}>
                    <LogIn size={16} /> 로그인
                  </button>
                  <button type="button" onClick={() => void submitAccount('register')} disabled={isBusy}>
                    <UserPlus size={16} /> 가입
                  </button>
                </div>
              </form>
            )}
            <p className="fine-print">{accountStatus}</p>
          </section>

          {showSettings && (
            <section className="panel-card">
              <div className="section-title">
                <Settings size={18} />
                <h2>서버</h2>
              </div>
              <input
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder={DEFAULT_ENDPOINT}
                aria-label="API 서버 주소"
              />
            </section>
          )}

          <section className="panel-card readiness-card">
            <div className="section-title">
              <ShieldCheck size={18} />
              <h2>배포 준비</h2>
              <button type="button" className="mini-button" onClick={() => void refreshReadiness()} disabled={!authSession || isBusy}>
                <RefreshCcw size={14} /> 점검
              </button>
            </div>
            {readiness ? (
              <>
                <div className="readiness-summary">
                  <span className={`status-pill ${readiness.productionReady ? 'good' : 'warn'}`}>
                    {readiness.productionReady ? '공개 준비' : '설정 필요'}
                  </span>
                  <span>준비 {readiness.summary.ready}</span>
                  <span>누락 {readiness.summary.missing}</span>
                  <span>주의 {readiness.summary.warning}</span>
                  <span>수동 {readiness.summary.manual}</span>
                </div>
                {readiness.release && (
                  <p className="fine-print">
                    릴리스 {readiness.release.tag} / <a href={readiness.release.downloadsUrl}>다운로드</a>
                  </p>
                )}
                <div className="readiness-list">
                  {readiness.items
                    .filter((item) => item.status !== 'ready')
                    .slice(0, 8)
                    .map((item) => (
                      <article className="readiness-item" key={item.id}>
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.category}</span>
                        </div>
                        <span className={`status-pill ${readinessTone(item.status)}`}>{readinessLabel(item.status)}</span>
                        <p>{item.detail}</p>
                        {item.action && <p className="fine-print">{item.action}</p>}
                      </article>
                    ))}
                </div>
              </>
            ) : (
              <p className="fine-print">로그인하면 운영 배포에 필요한 설정을 점검합니다.</p>
            )}
          </section>

          <section className="panel-card">
            <div className="section-title">
              <Lock size={18} />
              <h2>앱 연결</h2>
            </div>
            <div className="connector-list">
              {connectors.length === 0 ? (
                <p className="fine-print">로그인하면 연결 가능한 앱이 표시됩니다.</p>
              ) : (
                connectors.map((connector) => {
                  const shareFallback = connector.type === 'share' || connector.type === 'bot_or_share' || (connector.type === 'oauth_or_share' && !connector.needsOAuth)
                  return (
                    <div className="connector-item" key={connector.id}>
                      <div>
                        <strong>{connector.name}</strong>
                        <span>{connectorCopy(connector)}</span>
                      </div>
                      {connector.connected ? (
                        <button type="button" onClick={() => void disconnectProvider(connector)}>
                          <Unlink size={15} /> 해제
                        </button>
                      ) : (
                        <button type="button" onClick={() => void connectProvider(connector)} disabled={!connector.configured && connector.id !== 'telegram'}>
                          <ChevronRight size={15} /> {shareFallback ? '안내' : '연결'}
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </section>

          <section className="panel-card run-card">
            <div className="section-title">
              <Zap size={18} />
              <h2>실행</h2>
            </div>
            {activeRun ? (
              <>
                <div className="run-summary">
                  <strong>{activeRun.prompt}</strong>
                  <span>{activeRun.status}</span>
                </div>
                <div className="run-actions">
                  <button type="button" onClick={() => void approveRun()} disabled={pendingApprovals === 0 || isBusy}>
                    <CheckCircle2 size={16} /> 승인 {pendingApprovals}
                  </button>
                  <button type="button" className="primary-button" onClick={() => void executeRun()} disabled={pendingApprovals > 0 || isBusy}>
                    <Play size={16} /> 실행
                  </button>
                </div>
                <div className="step-list">
                  {activeRun.steps.map((step) => (
                    <article className="step-item" key={step.id}>
                      <div className="step-head">
                        <strong>{step.title}</strong>
                        <span className={`status-pill ${statusTone(step.status)}`}>{STATUS_LABEL[step.status]}</span>
                      </div>
                      <p>{step.detail}</p>
                      <div className="step-meta">
                        <span>
                          <CalendarDays size={14} /> {PROVIDER_LABEL[step.provider] || step.provider}
                        </span>
                        <span>
                          <ShieldCheck size={14} /> {step.risk}
                        </span>
                      </div>
                      {step.preview && <div className="preview-box">{step.preview}</div>}
                      {step.result?.message && <div className={`result-box ${step.result.ok ? 'good' : 'bad'}`}>{step.result.message}</div>}
                      {step.result?.shareText && (
                        <button type="button" onClick={() => void copyShareText(step.result?.shareText || '')}>
                          <Smartphone size={15} /> 공유창으로 넘기기
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <p className="fine-print">채팅으로 요청하면 실행 계획이 여기에 표시됩니다.</p>
            )}
          </section>

          <section className="panel-card audit-card">
            <div className="section-title">
              <ShieldCheck size={18} />
              <h2>감사 로그</h2>
              <button type="button" className="mini-button" onClick={() => void refreshAuditLogs()} disabled={!authSession || isBusy}>
                <RefreshCcw size={14} /> 새로고침
              </button>
            </div>
            {auditLogs.length ? (
              <div className="audit-list">
                {auditLogs.slice(0, 8).map((log) => {
                  const step = log.step || log.steps?.[0]
                  return (
                    <article className="audit-item" key={log.id}>
                      <div className="audit-head">
                        <strong>{auditLabel(log)}</strong>
                        <span>{new Date(log.createdAt).toLocaleString('ko-KR')}</span>
                      </div>
                      <p>
                        {step ? `${PROVIDER_LABEL[step.provider] || step.provider} / ${step.action}` : log.runId}
                        {step?.subject ? ` / ${step.subject}` : ''}
                      </p>
                      {log.result?.message && <span className={log.result.ok ? 'audit-ok' : 'audit-bad'}>{log.result.message}</span>}
                    </article>
                  )
                })}
              </div>
            ) : (
              <p className="fine-print">승인 또는 실행 기록이 여기에 표시됩니다.</p>
            )}
          </section>
        </aside>
      </section>
      <footer className="app-footer">
        <a href="/downloads">Downloads</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
        <a href="/data-deletion">Data Deletion</a>
      </footer>
    </main>
  )
}

function App() {
  const route = window.location.pathname.replace(/\/+$/, '') || '/'

  if (route === '/privacy') return <LegalPage kind="privacy" />
  if (route === '/terms') return <LegalPage kind="terms" />
  return <AppShell />
}

export default App
