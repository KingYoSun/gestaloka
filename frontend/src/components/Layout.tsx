import { Navigation } from './Navigation'
import { Header } from './Header'
import { ReactNode } from 'react'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen">
      {/* サイドナビゲーション */}
      <Navigation />
      
      {/* メインコンテンツエリア */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}