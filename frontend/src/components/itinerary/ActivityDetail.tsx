import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, MapPin, Clock, Lightbulb, DollarSign, CheckCircle2, Navigation, Wallet } from 'lucide-react'
import { ActivityData } from '../../utils/api'
import { MiniMap } from './MiniMap'

interface Props {
  activity: ActivityData | null
  onClose: () => void
  onCheckIn: (activityId: number, checkedIn: boolean, actualCost?: number) => void
  onUpdateCost?: (activityId: number, actualCost: number) => void
  destination?: string
}

function InfoRow({ icon: Icon, label, value, iconBg, iconColor }: {
  icon: typeof MapPin
  label: string
  value: string
  iconBg: string
  iconColor: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-9 h-9 rounded-xl ${iconBg} flex items-center justify-center flex-shrink-0`}>
        <Icon size={16} className={iconColor} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-slate-400 mb-0.5 font-medium uppercase tracking-wide">{label}</p>
        <p className="text-sm text-slate-700 leading-relaxed">{value}</p>
      </div>
    </div>
  )
}

export function ActivityDetail({ activity, onClose, onCheckIn, onUpdateCost, destination }: Props) {
  const [costInput, setCostInput] = useState('')
  const [showCostInput, setShowCostInput] = useState(false)

  if (!activity) return null

  const displayActualCost = activity.actual_cost > 0 ? activity.actual_cost : (costInput ? parseFloat(costInput) : 0)

  const handleCheckIn = (checkedIn: boolean) => {
    if (checkedIn && showCostInput && costInput) {
      const cost = parseFloat(costInput)
      if (!isNaN(cost) && cost >= 0) {
        onCheckIn(activity.id, true, cost)
        return
      }
    }
    onCheckIn(activity.id, checkedIn)
  }

  const handleSaveCost = () => {
    const cost = parseFloat(costInput)
    if (!isNaN(cost) && cost >= 0 && onUpdateCost) {
      onUpdateCost(activity.id, cost)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-end justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="bg-white w-full max-w-lg rounded-t-3xl max-h-[85vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-center pt-3 pb-1 flex-shrink-0">
            <div className="w-10 h-1 rounded-full bg-slate-200" />
          </div>

          <div className="px-5 pb-4 flex-shrink-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-slate-800 leading-tight">
                  {activity.title}
                </h2>
                {activity.location && (
                  <p className="text-xs text-slate-400 mt-1 flex items-center gap-1">
                    <MapPin size={11} />
                    {activity.location}
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 hover:bg-slate-200 transition-colors flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4 space-y-4">
            {activity.time_slot && (
              <InfoRow
                icon={Clock}
                label="时间"
                value={activity.time_slot}
                iconBg="bg-violet-50"
                iconColor="text-violet-500"
              />
            )}

            {activity.location && (
              <InfoRow
                icon={Navigation}
                label="地点"
                value={activity.location}
                iconBg="bg-sky-50"
                iconColor="text-sky-500"
              />
            )}

            {activity.location && (
              <MiniMap location={activity.location} title={activity.title} destination={destination} />
            )}

            {activity.cost > 0 && (
              <InfoRow
                icon={DollarSign}
                label="预算费用"
                value={`¥${activity.cost}`}
                iconBg="bg-amber-50"
                iconColor="text-amber-500"
              />
            )}

            {activity.actual_cost > 0 && (
              <InfoRow
                icon={Wallet}
                label="实际花费"
                value={`¥${activity.actual_cost}`}
                iconBg="bg-emerald-50"
                iconColor="text-emerald-500"
              />
            )}

            {activity.cost > 0 && activity.actual_cost > 0 && (
              <div className={`rounded-xl px-4 py-2.5 text-sm font-medium ${
                activity.actual_cost <= activity.cost
                  ? 'bg-emerald-50 text-emerald-600'
                  : 'bg-red-50 text-red-500'
              }`}>
                {activity.actual_cost <= activity.cost
                  ? `节省 ¥${(activity.cost - activity.actual_cost).toFixed(0)}`
                  : `超出预算 ¥${(activity.actual_cost - activity.cost).toFixed(0)}`}
              </div>
            )}

            <div className="bg-slate-50/80 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Wallet size={13} className="text-slate-500" />
                  <p className="text-xs text-slate-500 font-medium">记录花费</p>
                </div>
                {!showCostInput && (
                  <button
                    onClick={() => {
                      setShowCostInput(true)
                      setCostInput(activity.actual_cost > 0 ? String(activity.actual_cost) : '')
                    }}
                    className="text-xs text-sky-500 font-medium"
                  >
                    {activity.actual_cost > 0 ? '修改' : '填写'}
                  </button>
                )}
              </div>
              {showCostInput && (
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-sm">¥</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={costInput}
                    onChange={(e) => setCostInput(e.target.value)}
                    placeholder="输入实际花费"
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                  />
                  <button
                    onClick={() => {
                      handleSaveCost()
                      setShowCostInput(false)
                    }}
                    className="px-3 py-2 bg-sky-500 text-white text-xs font-medium rounded-xl hover:bg-sky-600 transition-colors"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setShowCostInput(false)}
                    className="px-3 py-2 bg-slate-100 text-slate-500 text-xs font-medium rounded-xl hover:bg-slate-200 transition-colors"
                  >
                    取消
                  </button>
                </div>
              )}
              {!showCostInput && activity.actual_cost === 0 && (
                <p className="text-xs text-slate-300">点击"填写"记录实际花费</p>
              )}
            </div>

            {activity.description && (
              <div className="bg-slate-50/80 rounded-2xl p-4">
                <p className="text-xs text-slate-400 font-medium mb-1.5 uppercase tracking-wide">详情</p>
                <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                  {activity.description}
                </p>
              </div>
            )}

            {activity.tips && (
              <div className="bg-emerald-50/60 rounded-2xl p-4 border border-emerald-100/50">
                <div className="flex items-center gap-2 mb-1.5">
                  <Lightbulb size={13} className="text-emerald-500" />
                  <p className="text-xs text-emerald-600 font-medium">小贴士</p>
                </div>
                <p className="text-sm text-emerald-700 leading-relaxed">{activity.tips}</p>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 px-5 py-4 border-t border-slate-100 bg-white">
            <button
              onClick={() => handleCheckIn(!activity.checked_in)}
              className={`
                w-full py-3.5 rounded-2xl font-medium text-sm transition-all active:scale-[0.98]
                ${
                  activity.checked_in
                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 hover:bg-emerald-100'
                    : 'bg-gradient-to-r from-sky-500 to-indigo-500 text-white hover:shadow-lg hover:shadow-sky-200/40'
                }
              `}
            >
              <span className="flex items-center justify-center gap-2">
                <CheckCircle2 size={17} />
                {activity.checked_in ? '取消打卡' : '打卡完成'}
              </span>
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
