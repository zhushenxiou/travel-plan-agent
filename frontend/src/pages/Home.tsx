import { useState, useEffect, useCallback, useRef } from 'react'
import { ChatWindow } from '../components/ChatWindow'
import { ChatInput } from '../components/ChatInput'
import { SessionSidebar } from '../components/SessionSidebar'
import { useChatStore } from '../hooks/useChatStore'
import { useAuthStore } from '../hooks/useAuthStore'
import { sendMessage, createSession } from '../utils/api'
import { MapPin } from 'lucide-react'

export function Home() {
  const {
    messages,
    isLoading,
    sessionId,
    userId,
    isEscalated,
    addMessage,
    setLoading,
    setEscalated,
    setSessionId,
    setUserId,
    resetSession,
  } = useChatStore()

  const authUserId = useAuthStore((s) => s.userId)
  const [activeSessionId, setActiveSessionId] = useState(sessionId)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (authUserId && !userId) {
      setUserId(authUserId)
    }
  }, [authUserId, userId, setUserId])

  useEffect(() => {
    if (!sessionId) {
      initSession()
    }
  }, [])

  const initSession = useCallback(async () => {
    try {
      const result = await createSession()
      setSessionId(result.session_id)
      if (authUserId) setUserId(authUserId)
      setActiveSessionId(result.session_id)
    } catch {
      resetSession()
      setActiveSessionId(useChatStore.getState().sessionId)
    }
  }, [authUserId, setSessionId, setUserId, resetSession])

  const handleSessionChange = (newSessionId: string) => {
    setActiveSessionId(newSessionId)
  }

  const handleNewChat = async () => {
    abortRef.current?.abort()
    try {
      const result = await createSession()
      resetSession()
      setSessionId(result.session_id)
      if (authUserId) setUserId(authUserId)
      setActiveSessionId(result.session_id)
    } catch {
      resetSession()
      setActiveSessionId(useChatStore.getState().sessionId)
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
    setLoading(false)
  }

  const handleSend = async (text: string) => {
    addMessage({ role: 'user', content: text })
    setLoading(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const currentSessionId = useChatStore.getState().sessionId
      const currentUserId = useChatStore.getState().userId
      const result = await sendMessage(
        {
          session_id: currentSessionId,
          user_id: currentUserId,
          message: text,
        },
        controller.signal,
      )
      addMessage({
        role: 'assistant',
        content: result.reply,
        status: result.status,
      })
      if (result.status === 'escalated') {
        setEscalated(true)
      }
    } catch (err) {
      if (controller.signal.aborted) {
        addMessage({
          role: 'assistant',
          content: '⏹ 已停止生成',
        })
      } else if (err instanceof Error && err.message === 'AUTH_EXPIRED') {
        useAuthStore.getState().logout()
        return
      } else {
        addMessage({
          role: 'assistant',
          content: `服务暂时不可用：${err instanceof Error ? err.message : '未知错误'}。请稍后重试。`,
        })
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  return (
    <div className="h-screen flex bg-slate-50">
      <SessionSidebar
        onSessionChange={handleSessionChange}
        activeSessionId={activeSessionId}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-sm">
            <MapPin size={18} className="text-white" />
          </div>
          <div>
            <h1
              className="text-base font-semibold text-slate-800 leading-tight"
              style={{ fontFamily: 'var(--font-display)' }}
            >
              Claw 旅行规划师
            </h1>
            <p className="text-xs text-slate-400">AI 规划 · 实时搜索 · 一键保存行程</p>
          </div>
        </header>

        <ChatWindow
          messages={messages}
          isLoading={isLoading}
          isEscalated={isEscalated}
          onQuickSend={handleSend}
        />

        <ChatInput
          onSend={handleSend}
          isLoading={isLoading}
          isEscalated={isEscalated}
          onClear={handleNewChat}
          onStop={handleStop}
        />
      </div>
    </div>
  )
}
