import { create } from 'zustand'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  status?: string
  timestamp: number
}

interface ChatState {
  messages: Message[]
  isLoading: boolean
  sessionId: string
  userId: string
  isEscalated: boolean
  addMessage: (msg: Omit<Message, 'id' | 'timestamp'>) => void
  setLoading: (loading: boolean) => void
  setSessionId: (id: string) => void
  setUserId: (id: string) => void
  setEscalated: (v: boolean) => void
  clearMessages: () => void
  loadMessages: (msgs: Array<{ role: string; content: string; created_at?: string }>) => void
  resetSession: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  sessionId: '',
  userId: '',
  isEscalated: false,
  addMessage: (msg) =>
    set((state) => ({
      messages: [
        ...state.messages,
        { ...msg, id: generateId(), timestamp: Date.now() },
      ],
    })),
  setLoading: (loading) => set({ isLoading: loading }),
  setSessionId: (id) => set({ sessionId: id }),
  setUserId: (id) => set({ userId: id }),
  setEscalated: (v) => set({ isEscalated: v }),
  clearMessages: () => set({ messages: [], isEscalated: false, sessionId: generateId() }),
  loadMessages: (msgs) =>
    set({
      messages: msgs.map((m, i) => ({
        id: `loaded-${i}`,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: m.created_at ? new Date(m.created_at).getTime() : Date.now(),
      })),
    }),
  resetSession: () => set({ messages: [], isEscalated: false, sessionId: generateId() }),
}))

function generateId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
}
