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
  type: string
  actions: string[]
  configured: boolean
  connected: boolean
  needsOAuth: boolean
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

const STORAGE_KEYS = {
  authSession: 'noclickai.authSession',
  endpoint: 'noclickai.endpoint',
  chatMessages: 'noclickai.chatMessages',
  activeRun: 'noclickai.activeRun',
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:8788'

const QUICK_PROMPTS = [
  '내일 오전 10시에 회의 잡고 참석자에게 메일 초안 만들어줘',
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
  if (!connector.configured) return '서버 설정 필요'
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

function App() {
  const [endpoint, setEndpoint] = useState(() => window.localStorage.getItem(STORAGE_KEYS.endpoint) || DEFAULT_ENDPOINT)
  const [authSession, setAuthSession] = useState<AuthSession | null>(() =>
    readJsonStorage<AuthSession | null>(STORAGE_KEYS.authSession, null),
  )
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accountStatus, setAccountStatus] = useState('로그인 전')
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null)
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    readJsonStorage<ChatMessage[]>(STORAGE_KEYS.chatMessages, [
      newMessage(
        'assistant',
        '무엇을 자동화할까요? 일정, 메일 초안, Notion 페이지, Slack 공지, Telegram 메시지를 한 문장으로 요청하세요.',
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
    setAccountStatus('로그아웃 완료')
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
    if (connector.id === 'telegram') {
      setMessages((items) => [
        ...items,
        newMessage('assistant', 'Telegram은 서버 .env에 TELEGRAM_BOT_TOKEN과 TELEGRAM_DEFAULT_CHAT_ID를 설정해야 합니다.'),
      ])
      return
    }
    if (!connector.configured) {
      setMessages((items) => [
        ...items,
        newMessage('assistant', `${connector.name} OAuth Client ID/Secret이 서버에 아직 설정되지 않았습니다.`),
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
    setIsBusy(true)
    try {
      const body = await apiFetch(`/v1/runs/${activeRun.id}/execute`, { method: 'POST' })
      setActiveRun(body.run)
      setMessages((items) => [...items, newMessage('assistant', '승인된 단계를 실행했습니다. 결과를 오른쪽에서 확인하세요.')])
      await refreshConnectors().catch(() => undefined)
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
              placeholder="예: 내일 오전 10시에 회의 잡고 참석자에게 메일 초안 만들어줘"
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
                    {authSession.user.billingPlan === 'pro' ? 'Pro' : 'Free'} / {authSession.user.subscriptionStatus}
                  </span>
                </div>
                <div className="button-grid">
                  <button type="button" onClick={() => void refreshBilling()} disabled={isBusy}>
                    <RefreshCcw size={16} /> 상태
                  </button>
                  <button type="button" onClick={() => void startCheckout()} disabled={isBusy}>
                    <CreditCard size={16} /> 구독
                  </button>
                  <button type="button" onClick={() => void openPortal()} disabled={isBusy || !(billingStatus?.portalReady ?? false)}>
                    <CreditCard size={16} /> 관리
                  </button>
                  <button type="button" onClick={() => void logout()} disabled={isBusy}>
                    <LogOut size={16} /> 로그아웃
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
                placeholder="http://127.0.0.1:8788"
                aria-label="API 서버 주소"
              />
            </section>
          )}

          <section className="panel-card">
            <div className="section-title">
              <Lock size={18} />
              <h2>앱 연결</h2>
            </div>
            <div className="connector-list">
              {connectors.length === 0 ? (
                <p className="fine-print">로그인하면 연결 가능한 앱이 표시됩니다.</p>
              ) : (
                connectors.map((connector) => (
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
                        <ChevronRight size={15} /> 연결
                      </button>
                    )}
                  </div>
                ))
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
        </aside>
      </section>
    </main>
  )
}

export default App
