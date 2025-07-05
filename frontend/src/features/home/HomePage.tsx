import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'

export function HomePage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/50 flex items-center justify-center">
      <div className="container mx-auto px-4 text-center">
        <h1 className="text-6xl font-bold mb-6">
          ゲスタロカ
          <span className="block text-3xl text-muted-foreground font-normal mt-2">
            GESTALOKA
          </span>
        </h1>

        <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
          自動更新シェアワールド・テキストRPG
          <br />
          あなたの選択が世界を変える
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
            <h3 className="text-lg font-semibold mb-2">AIによる物語生成</h3>
            <p className="text-muted-foreground">
              AIによって物語が生成され、世界が無限に広がります。
            </p>
          </div>

          <div className="p-6 rounded-lg bg-card border">
            <h3 className="text-lg font-semibold mb-2">ログNPCシステム</h3>
            <p className="text-muted-foreground">
              あなたの行動記録をもとにNPCを生成し、世界に解き放ちます。
            </p>
          </div>

          <div className="p-6 rounded-lg bg-card border">
            <h3 className="text-lg font-semibold mb-2">無限に更新される世界</h3>
            <p className="text-muted-foreground">
              あなたの物語が世界に影響し、世界は常に更新されます。他の人の痕跡も見つけるかもしれません。
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
