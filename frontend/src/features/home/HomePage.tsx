import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/50 flex items-center justify-center">
      <div className="container mx-auto px-4 text-center">
        <h1 className="text-6xl font-bold mb-6">
          ログバース
          <span className="block text-3xl text-muted-foreground font-normal mt-2">
            Logverse
          </span>
        </h1>
        
        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          マルチプレイ・テキストMMO<br />
          あなたの行動が物語となり、他のプレイヤーの世界に生きるNPCとなる
        </p>

        <div className="flex gap-4 justify-center">
          <Button asChild size="lg">
            <Link to="/login">ゲームを始める</Link>
          </Button>
          <Button variant="outline" size="lg" disabled>
            詳細を見る（準備中）
          </Button>
        </div>

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl mx-auto">
          <div className="p-6 rounded-lg bg-card border">
            <h3 className="text-lg font-semibold mb-2">動的な物語生成</h3>
            <p className="text-muted-foreground">
              AIが生成する無限の物語。あなたの選択が世界を変えていきます。
            </p>
          </div>
          
          <div className="p-6 rounded-lg bg-card border">
            <h3 className="text-lg font-semibold mb-2">ログNPCシステム</h3>
            <p className="text-muted-foreground">
              あなたの行動記録が他のプレイヤーの世界でNPCとして生まれ変わります。
            </p>
          </div>
          
          <div className="p-6 rounded-lg bg-card border">
            <h3 className="text-lg font-semibold mb-2">協調AI評議会</h3>
            <p className="text-muted-foreground">
              6つの専門AIが協力してリッチなゲーム体験を提供します。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}