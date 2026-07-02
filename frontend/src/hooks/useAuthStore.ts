import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthState {
  userId: string | null
  username: string | null
  token: string | null
  isAuthenticated: boolean
  login: (userId: string, username: string, token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
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
    }),
    {
      name: 'claw-auth',
      partialize: (state) => ({
        userId: state.userId,
        username: state.username,
        token: state.token,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
