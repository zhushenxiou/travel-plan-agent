import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { fetchSkills, fetchAgents, fetchMCPServers, createCustomAgent, updateCustomAgent, SkillInfo, AgentInfo, MCPServerInfo } from '../utils/api'

export function AgentEditor() {
  const navigate = useNavigate()
  const { agentId } = useParams()
  const isEdit = !!agentId

  const [form, setForm] = useState({
    name: '',
    description: '',
    icon: '🤖',
    system_prompt: '',
    skills: [] as string[],
    mcp_servers: [] as string[],
    welcome_message: '',
    temperature: 0.7,
    is_public: false,
  })

  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [mcpServers, setMcpServers] = useState<MCPServerInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [initLoading, setInitLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const init = async () => {
      try {
        const [skillsData, mcpData] = await Promise.all([
          fetchSkills(),
          fetchMCPServers(),
        ])
        if (cancelled) return
        setSkills(skillsData)
        setMcpServers(mcpData)
        if (isEdit && agentId) {
          // 编辑模式：加载现有智能体数据
          const data = await fetchAgents()
          if (cancelled) return
          const all = [...data.custom, ...data.public]
          const existing = all.find(a => a.id === agentId)
          if (existing) {
            setForm({
              name: existing.name || '',
              description: existing.description || '',
              icon: existing.icon || '🤖',
              system_prompt: existing.system_prompt || '',
              skills: existing.skills || [],
              mcp_servers: existing.mcp_servers || [],
              welcome_message: existing.welcome_message || '',
              temperature: existing.temperature ?? 0.7,
              is_public: existing.is_public ?? false,
            })
          } else {
            setError('智能体不存在')
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '加载失败')
        }
      } finally {
        if (!cancelled) setInitLoading(false)
      }
    }
    init()
    return () => { cancelled = true }
  }, [agentId, isEdit])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      if (isEdit && agentId) {
        await updateCustomAgent(agentId, form)
      } else {
        await createCustomAgent(form)
      }
      navigate('/agents')
    } catch (err) {
      setError(err instanceof Error ? err.message : (isEdit ? '保存失败' : '创建失败'))
    } finally {
      setLoading(false)
    }
  }

  const toggleSkill = (skillName: string) => {
    setForm(prev => ({
      ...prev,
      skills: prev.skills.includes(skillName)
        ? prev.skills.filter(s => s !== skillName)
        : [...prev.skills, skillName],
    }))
  }

  const toggleMCP = (serverId: string) => {
    setForm(prev => ({
      ...prev,
      mcp_servers: prev.mcp_servers.includes(serverId)
        ? prev.mcp_servers.filter(s => s !== serverId)
        : [...prev.mcp_servers, serverId],
    }))
  }

  if (initLoading) {
    return <div className="max-w-2xl mx-auto p-6 text-slate-400">加载中...</div>
  }

  if (error && !form.name && !isEdit) {
    return <div className="max-w-2xl mx-auto p-6 text-red-600">{error}</div>
  }

  return (
    <div className="max-w-2xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/agents')}
          className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
          title="返回"
        >
          <ArrowLeft size={20} className="text-slate-600" />
        </button>
        <h1 className="text-2xl font-bold text-slate-800">{isEdit ? '编辑智能体' : '创建智能体'}</h1>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 rounded-lg bg-red-50 text-red-600 text-sm">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 基本信息 */}
        <div>
          <label className="block text-sm font-medium mb-2 text-slate-700">图标</label>
          <input
            type="text"
            value={form.icon}
            onChange={e => setForm({ ...form, icon: e.target.value })}
            className="w-20 px-3 py-2 border border-slate-300 rounded-lg"
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-slate-700">名称</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-slate-700">描述</label>
          <textarea
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg"
            rows={3}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-slate-700">系统提示词</label>
          <textarea
            value={form.system_prompt}
            onChange={e => setForm({ ...form, system_prompt: e.target.value })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm"
            rows={6}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-slate-700">温度 (0-1)</label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={form.temperature}
            onChange={e => setForm({ ...form, temperature: parseFloat(e.target.value) })}
            className="w-full"
          />
          <span className="text-sm text-slate-500">{form.temperature}</span>
        </div>

        {/* Skill 选择器 */}
        <div>
          <label className="block text-sm font-medium mb-2 text-slate-700">选择 Skill</label>
          <div className="space-y-2">
            {skills.length === 0 && (
              <p className="text-sm text-slate-400">暂无可用 Skill</p>
            )}
            {skills.map(skill => (
              <div
                key={skill.name}
                className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                  form.skills.includes(skill.name) ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:border-slate-300'
                }`}
                onClick={() => toggleSkill(skill.name)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 flex items-center gap-1.5">
                      <span>{skill.icon}</span>
                      {skill.display_name}
                    </div>
                    <div className="text-sm text-slate-500 mt-0.5">{skill.description}</div>
                  </div>
                  <div className="text-sm flex-shrink-0 ml-2">
                    {skill.requires_env.length > 0 && (
                      <span className={skill.env_configured ? 'text-green-600' : 'text-orange-600'}>
                        {skill.env_configured ? '✓ 已配置' : '⚠ 未配置'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* MCP 选择器（新增） */}
        <div>
          <label className="block text-sm font-medium mb-2 text-slate-700">选择 MCP 服务</label>
          <div className="space-y-2">
            {mcpServers.length === 0 && (
              <p className="text-sm text-slate-400">暂无可用 MCP 服务</p>
            )}
            {mcpServers.map(server => {
              const hasAdapter = server.tools.some(t => t.adapter_available)
              return (
                <div
                  key={server.identifier}
                  className={`border rounded-lg p-3 transition-colors ${
                    form.mcp_servers.includes(server.identifier)
                      ? 'border-amber-500 bg-amber-50'
                      : hasAdapter
                        ? 'border-slate-200 hover:border-slate-300 cursor-pointer'
                        : 'border-slate-100 bg-slate-50 cursor-not-allowed opacity-60'
                  }`}
                  onClick={() => {
                    if (hasAdapter) toggleMCP(server.identifier)
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-800">{server.name}</div>
                      <div className="text-sm text-slate-500 mt-0.5">{server.description}</div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {server.tools.map(tool => (
                          <span
                            key={tool.proxy_name}
                            className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                              tool.adapter_available
                                ? 'bg-green-50 text-green-700'
                                : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            {tool.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="text-sm flex-shrink-0 ml-2">
                      <span className={hasAdapter ? 'text-green-600' : 'text-orange-600'}>
                        {hasAdapter ? '可用' : '未安装'}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 公开设置 */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="is_public"
            checked={form.is_public}
            onChange={e => setForm({ ...form, is_public: e.target.checked })}
            className="w-4 h-4"
          />
          <label htmlFor="is_public" className="text-sm text-slate-700">公开到社区</label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-sky-500 text-white py-3 rounded-lg font-medium hover:bg-sky-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? '处理中...' : (isEdit ? '保存' : '创建')}
        </button>
      </form>
    </div>
  )
}
