import { create } from 'zustand'

export interface AuthState {
  userId: string | null
  username: string | null
  token: string | null
  isAuthenticated: boolean
  login: (userId: string, username: string, token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  username: null,
  token: null,
  isAuthenticated: false,
  login: (userId, username, token) => {
    set({ userId, username, token, isAuthenticated: true })
  },
  logout: () => {
    set({ userId: null, username: null, token: null, isAuthenticated: false })
  },
}))
