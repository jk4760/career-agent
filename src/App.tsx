import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Briefcase, FolderOpen, MessagesSquare, Settings, Sparkles } from 'lucide-react'
import { LogoMark } from '@/components/LogoMark'
import { useMemoryRepository } from '@/lib/memoryRepository'
import { RepositoryContext } from '@/lib/repository'
import AssistantPage from '@/pages/AssistantPage'
import JobsPage from '@/pages/JobsPage'
import MaterialsPage from '@/pages/MaterialsPage'
import PreferencesPage from '@/pages/PreferencesPage'
import QuestionsPage from '@/pages/QuestionsPage'

const navItems = [
  { to: '/jobs', label: '岗位流', icon: Briefcase, desc: '查看 AI 采集的岗位，逐条标记反馈' },
  { to: '/materials', label: '素材库', icon: FolderOpen, desc: '一行一个可讲的故事，服务面试表达' },
  { to: '/questions', label: '问题库', icon: MessagesSquare, desc: '维护面试问题、回答草稿与关联故事' },
  { to: '/assistant', label: 'AI 助手', icon: Sparkles, desc: '总结项目、改简历、备面试（M5 上线）' },
  { to: '/preferences', label: '偏好设置', icon: Settings, desc: '静态筛选条件，供采集匹配使用' },
]

function navLinkClass({ isActive }: { isActive: boolean }, extra = '') {
  return `relative flex h-11 items-center gap-2.5 rounded-md px-3 text-sm whitespace-nowrap transition-colors sm:h-9 ${extra} ${
    isActive
      ? 'bg-accent font-medium text-accent-foreground before:absolute before:top-2 before:bottom-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary before:content-[""]'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`
}

function Header() {
  const { pathname } = useLocation()
  const current = navItems.find((item) => pathname.startsWith(item.to)) ?? navItems[0]

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-6 sm:px-8">
      <h1 className="text-lg font-semibold">{current.label}</h1>
      <span className="hidden text-sm text-muted-foreground sm:inline">{current.desc}</span>
    </header>
  )
}

export default function App() {
  const repository = useMemoryRepository()

  return (
    <RepositoryContext.Provider value={repository}>
      <BrowserRouter>
        <div className="flex min-h-screen bg-background">
          {/* 桌面端左侧导航 */}
          <aside className="sticky top-0 hidden h-screen w-[232px] shrink-0 flex-col border-r bg-sidebar p-3 sm:flex">
            {/* 品牌区（§10.8）：Logo + 字标 + 副标题 */}
            <div className="mb-4 flex items-center gap-2 px-3 pt-2">
              <LogoMark size={20} />
              <div>
                <div className="text-base font-bold tracking-[-0.02em]">
                  <span className="text-slate-900">Next</span>
                  <span className="text-primary">Career</span>
                </div>
                <div className="text-xs text-muted-foreground">Jackie 的个人工作台</div>
              </div>
            </div>
            <nav className="flex flex-col gap-0.5">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} className={navLinkClass}>
                  <item.icon className="size-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* 移动端顶部导航 */}
            <nav className="grid grid-cols-5 gap-1 border-b bg-background p-2 sm:hidden">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={(s) => navLinkClass(s, 'justify-center gap-1.5 px-2')}
                >
                  <item.icon className="size-4" />
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <Header />

            <main className="mx-auto w-full max-w-6xl flex-1 p-6 sm:p-8">
              <Routes>
                <Route path="/" element={<Navigate to="/jobs" replace />} />
                <Route path="/jobs" element={<JobsPage />} />
                <Route path="/materials" element={<MaterialsPage />} />
                <Route path="/questions" element={<QuestionsPage />} />
                <Route path="/assistant" element={<AssistantPage />} />
                <Route path="/preferences" element={<PreferencesPage />} />
                <Route path="*" element={<Navigate to="/jobs" replace />} />
              </Routes>
            </main>
          </div>
        </div>
      </BrowserRouter>
    </RepositoryContext.Provider>
  )
}
