import { useState, useEffect, useCallback } from 'react'
import { Brain, Trash2, RefreshCw, Heart, BookOpen, Lightbulb, ChevronDown, ChevronUp } from 'lucide-react'
import { getMemories, deleteMemory, MemoriesResponse, MemoryItem } from '../utils/api'

const _CATEGORY_CONFIG: Record<string, { icon: typeof Heart; color: string; bg: string }> = {
  preference: { icon: Heart, color: 'text-pink-500', bg: 'bg-pink-50' },
  fact: { icon: BookOpen, color: 'text-blue-500', bg: 'bg-blue-50' },
  experience: { icon: Lightbulb, color: 'text-amber-500', bg: 'bg-amber-50' },
}

function MemoryCard({
  item,
  memoryType,
  onDeleted,
}: {
  item: MemoryItem
  memoryType: 'short_term' | 'long_term'
  onDeleted: () => void
}) {
  const cfg = _CATEGORY_CONFIG[item.category] || _CATEGORY_CONFIG.fact
  const Icon = cfg.icon
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteMemory(memoryType, item.id)
      onDeleted()
    } catch {
      /* ignore */
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="group flex items-start gap-2 px-2 py-2 rounded-lg hover:bg-slate-50 transition-colors">
      <div className={`w-6 h-6 rounded-md ${cfg.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
        <Icon size={12} className={cfg.color} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-700 leading-relaxed">{item.content}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-slate-400">{item.category_label}</span>
          {item.experience_tag && (
            <span className={`text-[10px] font-medium ${item.experience_tag === 'success' ? 'text-emerald-500' : 'text-red-400'}`}>
              {item.experience_tag === 'success' ? '✓ 成功' : '✗ 失败'}
            </span>
          )}
          {item.extraction_count > 0 && (
            <span className="text-[10px] text-slate-300">×{item.extraction_count}</span>
          )}
        </div>
      </div>
      <button
        onClick={handleDelete}
        disabled={deleting}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-slate-300 hover:text-red-400 transition-all flex-shrink-0"
        title="删除记忆"
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}

export function MemoryPanel() {
  const [data, setData] = useState<MemoriesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [showLtm, setShowLtm] = useState(true)
  const [showStm, setShowStm] = useState(true)

  const fetchMemories = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getMemories()
      setData(res)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMemories()
  }, [fetchMemories])

  if (!data) {
    return (
      <div className="px-3 py-4">
        <div className="flex items-center gap-2 mb-3">
          <Brain size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-slate-700">旅行记忆</span>
        </div>
        <div className="text-center py-4">
          {loading ? (
            <RefreshCw size={14} className="text-slate-300 animate-spin mx-auto" />
          ) : (
            <p className="text-[10px] text-slate-400">加载失败</p>
          )}
        </div>
      </div>
    )
  }

  const { long_term, short_term, summary } = data
  const total = summary.total_ltm + summary.total_stm

  return (
    <div className="px-3 py-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain size={14} className="text-violet-500" />
          <span className="text-xs font-semibold text-slate-700">旅行记忆</span>
          {total > 0 && (
            <span className="text-[10px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full font-medium">
              {total}
            </span>
          )}
        </div>
        <button
          onClick={fetchMemories}
          disabled={loading}
          className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="刷新"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {total === 0 ? (
        <div className="text-center py-4">
          <Brain size={20} className="text-slate-200 mx-auto mb-1.5" />
          <p className="text-[10px] text-slate-400">暂无记忆</p>
          <p className="text-[10px] text-slate-300 mt-0.5">对话中会自动提取偏好和经验</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-3">
            <div className="flex items-center gap-1">
              <Heart size={9} className="text-pink-400" />
              <span className="text-[10px] text-slate-500">{summary.preferences}偏好</span>
            </div>
            <div className="flex items-center gap-1">
              <BookOpen size={9} className="text-blue-400" />
              <span className="text-[10px] text-slate-500">{summary.facts}事实</span>
            </div>
            <div className="flex items-center gap-1">
              <Lightbulb size={9} className="text-amber-400" />
              <span className="text-[10px] text-slate-500">{summary.experiences}经验</span>
            </div>
          </div>

          {long_term.length > 0 && (
            <div className="mb-2">
              <button
                onClick={() => setShowLtm(!showLtm)}
                className="flex items-center gap-1 w-full text-left px-1 py-1 rounded hover:bg-slate-50 transition-colors"
              >
                {showLtm ? <ChevronDown size={10} className="text-slate-400" /> : <ChevronUp size={10} className="text-slate-400" />}
                <span className="text-[10px] font-medium text-slate-500">长期记忆</span>
                <span className="text-[10px] text-slate-300">{summary.total_ltm}条</span>
              </button>
              {showLtm && (
                <div className="space-y-0.5 mt-0.5">
                  {long_term.map((m) => (
                    <MemoryCard key={m.id} item={m} memoryType="long_term" onDeleted={fetchMemories} />
                  ))}
                </div>
              )}
            </div>
          )}

          {short_term.length > 0 && (
            <div>
              <button
                onClick={() => setShowStm(!showStm)}
                className="flex items-center gap-1 w-full text-left px-1 py-1 rounded hover:bg-slate-50 transition-colors"
              >
                {showStm ? <ChevronDown size={10} className="text-slate-400" /> : <ChevronUp size={10} className="text-slate-400" />}
                <span className="text-[10px] font-medium text-slate-500">短期记忆</span>
                <span className="text-[10px] text-slate-300">{summary.total_stm}条</span>
              </button>
              {showStm && (
                <div className="space-y-0.5 mt-0.5">
                  {short_term.map((m) => (
                    <MemoryCard key={m.id} item={m} memoryType="short_term" onDeleted={fetchMemories} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
