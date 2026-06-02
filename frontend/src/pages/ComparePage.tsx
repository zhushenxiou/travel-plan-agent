import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, MapPin, Calendar, Wallet, CheckCircle2, BarChart3, ArrowRightLeft, Plane } from 'lucide-react'
import { listItineraries, compareItineraries, ItineraryListItem, CompareItineraryItem } from '../utils/api'

export function ComparePage() {
  const navigate = useNavigate()
  const [itineraries, setItineraries] = useState<ItineraryListItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [comparing, setComparing] = useState(false)
  const [results, setResults] = useState<CompareItineraryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listItineraries()
      .then(setItineraries)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const toggleSelect = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) {
      next.delete(id)
    } else if (next.size < 4) {
      next.add(id)
    }
    setSelected(next)
  }

  const handleCompare = async () => {
    if (selected.size < 2) return
    setComparing(true)
    try {
      const data = await compareItineraries(Array.from(selected))
      setResults(data.itineraries)
    } catch {
      setResults([])
    }
  }

  const maxDays = Math.max(...results.map((r) => r.days_count), 1)

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center mx-auto mb-3 shadow-lg shadow-sky-200/50">
            <Plane size={24} className="text-white" />
          </div>
          <p className="text-slate-400 text-sm">加载中...</p>
        </div>
      </div>
    )
  }

  if (results.length > 0) {
    return (
      <div className="h-screen flex flex-col bg-slate-50">
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => { setResults([]); setComparing(false) }}
            className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1">
            <h1 className="text-base font-semibold text-slate-800">行程对比</h1>
            <p className="text-xs text-slate-400">{results.length} 个方案</p>
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-4">
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${results.length}, minmax(0, 1fr))` }}>
            {results.map((itin) => (
              <div key={itin.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                <div className="bg-gradient-to-br from-sky-500 to-indigo-500 px-4 py-3">
                  <h3 className="text-sm font-bold text-white truncate">{itin.title}</h3>
                  <p className="text-[10px] text-white/60 mt-0.5 flex items-center gap-1">
                    <MapPin size={9} />
                    {itin.destination}
                  </p>
                </div>

                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-slate-50 rounded-xl p-2.5 text-center">
                      <p className="text-[10px] text-slate-400">天数</p>
                      <p className="text-base font-bold text-slate-700">{itin.days_count}</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-2.5 text-center">
                      <p className="text-[10px] text-slate-400">活动</p>
                      <p className="text-base font-bold text-slate-700">{itin.activities_count}</p>
                    </div>
                    <div className="bg-amber-50 rounded-xl p-2.5 text-center">
                      <p className="text-[10px] text-amber-500">预算</p>
                      <p className="text-sm font-bold text-amber-600">¥{itin.budget_total.toFixed(0)}</p>
                    </div>
                    <div className="bg-emerald-50 rounded-xl p-2.5 text-center">
                      <p className="text-[10px] text-emerald-500">实际</p>
                      <p className="text-sm font-bold text-emerald-600">¥{itin.actual_total.toFixed(0)}</p>
                    </div>
                  </div>

                  {itin.days.map((day) => (
                    <div key={day.day_index} className="border-t border-slate-50 pt-3">
                      <p className="text-xs font-semibold text-slate-600 mb-1.5">
                        Day {day.day_index + 1}
                        {day.title ? ` · ${day.title}` : ''}
                      </p>
                      <div className="space-y-1">
                        {day.activities.map((act, ai) => (
                          <div key={ai} className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-500 truncate flex-1 min-w-0">
                              {act.time_slot && <span className="text-slate-300 mr-1">{act.time_slot}</span>}
                              {act.title}
                            </span>
                            <span className="text-slate-400 ml-2 flex-shrink-0">
                              {act.cost > 0 ? `¥${act.cost}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => navigate('/')}
          className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-base font-semibold text-slate-800">行程对比</h1>
          <p className="text-xs text-slate-400">选择 2-4 个行程进行对比</p>
        </div>
        <span className="text-xs text-slate-400 bg-slate-100 px-2.5 py-1 rounded-full">
          已选 {selected.size}/4
        </span>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {itineraries.length === 0 ? (
          <div className="flex items-center justify-center h-full text-slate-400 text-sm">
            暂无行程，请先创建行程
          </div>
        ) : (
          itineraries.map((itin) => {
            const isSelected = selected.has(itin.id)
            return (
              <motion.button
                key={itin.id}
                onClick={() => toggleSelect(itin.id)}
                className={`w-full text-left rounded-2xl p-4 transition-all border-2 ${
                  isSelected
                    ? 'border-sky-400 bg-sky-50/50 shadow-sm'
                    : 'border-transparent bg-white shadow-sm hover:border-slate-200'
                }`}
                whileTap={{ scale: 0.98 }}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                    isSelected ? 'border-sky-500 bg-sky-500' : 'border-slate-300'
                  }`}>
                    {isSelected && <CheckCircle2 size={12} className="text-white" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700 truncate">{itin.title}</p>
                    <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><MapPin size={10} />{itin.destination}</span>
                      {itin.start_date && (
                        <span className="flex items-center gap-1"><Calendar size={10} />{itin.start_date}</span>
                      )}
                      {itin.budget && (
                        <span className="flex items-center gap-1"><Wallet size={10} />{itin.budget}</span>
                      )}
                    </div>
                  </div>
                </div>
              </motion.button>
            )
          })
        )}
      </div>

      <div className="flex-shrink-0 px-4 py-4 bg-white border-t border-slate-100">
        <button
          onClick={handleCompare}
          disabled={selected.size < 2 || comparing}
          className={`w-full py-3.5 rounded-2xl font-medium text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${
            selected.size >= 2
              ? 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white hover:shadow-lg hover:shadow-sky-200/40'
              : 'bg-slate-100 text-slate-400 cursor-not-allowed'
          }`}
        >
          <ArrowRightLeft size={16} />
          {comparing ? '对比中...' : `对比 ${selected.size} 个行程`}
        </button>
      </div>
    </div>
  )
}
