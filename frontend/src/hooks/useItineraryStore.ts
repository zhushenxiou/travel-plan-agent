import { create } from 'zustand'
import {
  getItinerary,
  checkInActivity as apiCheckIn,
  deleteActivity as apiDeleteActivity,
  updateActivityCost as apiUpdateCost,
  ItineraryData,
  ActivityData,
} from '../utils/api'

interface ItineraryState {
  itinerary: ItineraryData | null
  loading: boolean
  error: string | ''
  selectedDayIndex: number
  detailActivity: ActivityData | null
  loadItinerary: (id: string) => Promise<void>
  checkIn: (activityId: number, checkedIn: boolean, actualCost?: number) => Promise<void>
  updateCost: (activityId: number, actualCost: number) => Promise<void>
  removeActivity: (activityId: number) => Promise<void>
  setSelectedDay: (index: number) => void
  setDetailActivity: (activity: ActivityData | null) => void
  reset: () => void
}

export const useItineraryStore = create<ItineraryState>((set, get) => ({
  itinerary: null,
  loading: false,
  error: '',
  selectedDayIndex: 0,
  detailActivity: null,

  loadItinerary: async (id: string) => {
    set({ loading: true, error: '' })
    try {
      const data = await getItinerary(id)
      set({ itinerary: data, loading: false, selectedDayIndex: 0 })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '加载失败', loading: false })
    }
  },

  checkIn: async (activityId: number, checkedIn: boolean, actualCost?: number) => {
    const { itinerary } = get()
    if (!itinerary) return
    try {
      const updated = await apiCheckIn(itinerary.id, activityId, checkedIn)
      set((state) => {
        if (!state.itinerary?.days) return state
        const newDays = state.itinerary.days.map((day) => ({
          ...day,
          activities: day.activities.map((act) =>
            act.id === activityId ? { ...act, checked_in: updated.checked_in, actual_cost: actualCost ?? act.actual_cost } : act,
          ),
        }))
        const newDetail = state.detailActivity?.id === activityId
          ? { ...state.detailActivity, checked_in: updated.checked_in, actual_cost: actualCost ?? state.detailActivity.actual_cost }
          : state.detailActivity
        return { itinerary: { ...state.itinerary, days: newDays }, detailActivity: newDetail }
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '打卡失败' })
    }
  },

  updateCost: async (activityId: number, actualCost: number) => {
    const { itinerary } = get()
    if (!itinerary) return
    try {
      const updated = await apiUpdateCost(itinerary.id, activityId, actualCost)
      set((state) => {
        if (!state.itinerary?.days) return state
        const newDays = state.itinerary.days.map((day) => ({
          ...day,
          activities: day.activities.map((act) =>
            act.id === activityId ? { ...act, actual_cost: updated.actual_cost } : act,
          ),
        }))
        const newDetail = state.detailActivity?.id === activityId
          ? { ...state.detailActivity, actual_cost: updated.actual_cost }
          : state.detailActivity
        return { itinerary: { ...state.itinerary, days: newDays }, detailActivity: newDetail }
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '更新花费失败' })
    }
  },

  removeActivity: async (activityId: number) => {
    const { itinerary } = get()
    if (!itinerary) return
    try {
      await apiDeleteActivity(itinerary.id, activityId)
      set((state) => {
        if (!state.itinerary?.days) return state
        const newDays = state.itinerary.days.map((day) => ({
          ...day,
          activities: day.activities.filter((act) => act.id !== activityId),
        }))
        return { itinerary: { ...state.itinerary, days: newDays } }
      })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : '删除失败' })
    }
  },

  setSelectedDay: (index: number) => set({ selectedDayIndex: index }),

  setDetailActivity: (activity: ActivityData | null) => set({ detailActivity: activity }),

  reset: () =>
    set({
      itinerary: null,
      loading: false,
      error: '',
      selectedDayIndex: 0,
      detailActivity: null,
    }),
}))
