import { useState, useRef, useEffect } from 'react'
import { Send, RotateCcw, Square } from 'lucide-react'

interface Props {
  onSend: (message: string) => void
  isLoading: boolean
  isEscalated: boolean
  onClear: () => void
  onStop: () => void
}

export function ChatInput({ onSend, isLoading, isEscalated, onClear, onStop }: Props) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = () => {
    const trimmed = text.trim()
    if (!trimmed || isLoading) return
    onSend(trimmed)
    setText('')
    setTimeout(() => {
      inputRef.current?.focus()
    }, 50)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const disabled = isLoading || isEscalated

  return (
    <div className="border-t border-slate-200 bg-white px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <button
          onClick={onClear}
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors flex-shrink-0"
          title="新对话"
        >
          <RotateCcw size={18} />
        </button>
        <div className="flex-1 relative">
          <textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isEscalated
                ? '人工客服接入中，请稍候...'
                : '请输入您的问题...'
            }
            disabled={disabled}
            rows={1}
            className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ maxHeight: '120px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = 'auto'
              target.style.height = Math.min(target.scrollHeight, 120) + 'px'
            }}
          />
          {isLoading ? (
            <button
              onClick={onStop}
              className="absolute right-2 bottom-2 p-2 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-all"
              title="停止生成"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={!text.trim() || disabled}
              className="absolute right-2 bottom-2 p-2 rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
      <p className="text-center text-xs text-slate-400 mt-2">
        Claw 旅行助手 · AI 生成内容仅供参考
      </p>
    </div>
  )
}
