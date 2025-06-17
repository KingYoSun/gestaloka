# 戦闘システムE2Eテスト仕様

## 概要
戦闘システムのエンドツーエンドテストケースを定義します。これらのテストは、フロントエンドとバックエンドの統合動作を検証します。

## テストケース

### 1. 戦闘開始フロー
- [ ] プレイヤーが探索中に敵と遭遇
- [ ] 戦闘開始通知が表示される
- [ ] BattleStatusコンポーネントが表示される
- [ ] 戦闘選択肢（攻撃、防御、逃走）が表示される
- [ ] WebSocketで戦闘開始イベントが送信される

### 2. 戦闘アクション実行
- [ ] 「攻撃する」を選択
  - ダメージ計算が実行される
  - HPバーが更新される
  - 戦闘ログに結果が追加される
  - 敵のターンに移行する
- [ ] 「防御する」を選択
  - 防御状態になる
  - 状態効果が表示される
  - ダメージ軽減が適用される
- [ ] 「逃げる」を選択
  - 速度差による成功判定
  - 成功時：戦闘終了、通常画面に戻る
  - 失敗時：敵のターンに移行

### 3. 敵ターン処理
- [ ] 敵の行動が自動実行される
- [ ] プレイヤーへのダメージ計算
- [ ] 戦闘ログ更新
- [ ] プレイヤーターンに戻る

### 4. 戦闘終了条件
- [ ] 勝利条件
  - 敵のHPが0になる
  - 勝利メッセージ表示
  - 経験値・報酬獲得
  - 通常画面に戻る
- [ ] 敗北条件
  - プレイヤーのHPが0になる
  - 敗北メッセージ表示
  - ペナルティ適用（未実装）
  - 復活処理（未実装）

### 5. WebSocket通信
- [ ] battle_startイベント受信
- [ ] battle_updateイベント受信
- [ ] battle_endイベント受信
- [ ] リアルタイムHP/MP更新
- [ ] 切断時の再接続処理

### 6. UI/UX検証
- [ ] 戦闘中も通常の物語UIを維持
- [ ] スムーズなアニメーション（HPバー変化）
- [ ] レスポンシブデザイン対応
- [ ] エラー状態の適切な表示

## 実装方法

### Playwright使用例
```typescript
test('戦闘開始から勝利まで', async ({ page }) => {
  // ログインとゲーム開始
  await page.goto('/');
  await loginUser(page, testUser);
  await startGameSession(page, testCharacter);
  
  // 戦闘トリガーアクション実行
  await page.fill('[data-testid="action-input"]', '森を探索する');
  await page.click('[data-testid="action-submit"]');
  
  // 戦闘開始を確認
  await expect(page.locator('[data-testid="battle-status"]')).toBeVisible();
  await expect(page.locator('text=戦闘開始！')).toBeVisible();
  
  // 攻撃を選択
  await page.click('button:has-text("攻撃する")');
  
  // 戦闘結果を確認
  await expect(page.locator('[data-testid="battle-log"]')).toContainText('ダメージ');
  
  // 戦闘終了まで攻撃を繰り返す
  while (await page.locator('[data-testid="battle-status"]').isVisible()) {
    if (await page.locator('button:has-text("攻撃する")').isVisible()) {
      await page.click('button:has-text("攻撃する")');
      await page.waitForTimeout(500); // アニメーション待機
    }
  }
  
  // 勝利を確認
  await expect(page.locator('text=戦闘に勝利した')).toBeVisible();
  await expect(page.locator('text=経験値')).toBeVisible();
});
```

## テスト環境セットアップ

### 必要なサービス
1. PostgreSQL（キャラクターデータ）
2. Neo4j（関係性データ）
3. Redis（セッション管理）
4. Backend API（FastAPI）
5. Frontend（Vite dev server）

### テストデータ
- テストユーザーアカウント
- レベル5のテストキャラクター
- 戦闘用の敵データ（ゴブリン、オーク等）
- 初期装備・アイテム

## CI/CD統合
```yaml
# .github/workflows/e2e-tests.yml
name: E2E Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Start services
        run: docker-compose up -d
      - name: Wait for services
        run: ./scripts/wait-for-services.sh
      - name: Run E2E tests
        run: npm run test:e2e
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: test-results/
```