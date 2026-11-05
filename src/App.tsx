import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useMemoryRepository } from '@/lib/memoryRepository'
import { RepositoryContext } from '@/lib/repository'
import JobsPage from '@/pages/JobsPage'
import MaterialsPage from '@/pages/MaterialsPage'
import PreferencesPage from '@/pages/PreferencesPage'
import QuestionsPage from '@/pages/QuestionsPage'

const navItems = [
  { to: '/jobs', label: '岗位流' },
  { to: '/materials', label: '素材库' },
  { to: '/questions', label: '问题库' },
  { to: '/preferences', label: '偏好设置' },
]

export default function App() {
  const repository = useMemoryRepository()

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors ${
      isActive
        ? 'bg-secondary font-medium text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    }`

  return (
    <RepositoryContext.Provider value={repository}>
      <BrowserRouter>
        <div className="flex min-h-screen bg-muted/30">
          {/* 桌面端左侧导航 */}
          <aside className="hidden min-h-screen w-48 shrink-0 flex-col gap-1 border-r bg-background p-4 sm:flex">
            <div className="mb-4 px-3">
              <div className="font-semibold">Career Agent</div>
              <div className="text-xs text-muted-foreground">个人求职工作台</div>
            </div>
            {navItems.map((item) => (
              <NavLink key={item.to} to={item.to} className={navLinkClass}>
                {item.label}
              </NavLink>
            ))}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* 移动端顶部导航 */}
            <nav className="flex gap-1 overflow-x-auto border-b bg-background p-2 sm:hidden">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} className={navLinkClass}>
                  {item.label}
                </NavLink>
              ))}
            </nav>

            <main className="mx-auto w-full max-w-5xl flex-1 p-4 sm:p-6">
              <Routes>
                <Route path="/" element={<Navigate to="/jobs" replace />} />
                <Route path="/jobs" element={<JobsPage />} />
                <Route path="/materials" element={<MaterialsPage />} />
                <Route path="/questions" element={<QuestionsPage />} />
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
