# ログバース ドキュメント

このディレクトリには、ログバースプロジェクトのすべての設計・仕様・実装ドキュメントが含まれています。

## 📖 ドキュメントの読み方

### 段階的読み込み戦略

1. **はじめに**: [SUMMARY.md](SUMMARY.md)でプロジェクト全体を把握
2. **カテゴリー理解**: 各ディレクトリの`summary.md`で概要を確認
3. **詳細確認**: 必要に応じて個別のドキュメントを参照

### 作業別ガイド

#### 🚀 新機能を実装する場合
1. [01_project/summary.md](01_project/summary.md) - MVP要件の確認
2. [03_worldbuilding/summary.md](03_worldbuilding/summary.md) - 世界観との整合性確認
3. [02_architecture/summary.md](02_architecture/summary.md) - アーキテクチャパターンの確認

#### 🤖 AI機能を実装する場合
1. [04_ai_agents/summary.md](04_ai_agents/summary.md) - GM AI評議会の概要
2. [02_architecture/api/gemini_api_specification.md](02_architecture/api/gemini_api_specification.md) - API仕様
3. 該当するAIエージェントの詳細仕様

#### 🐛 トラブルシューティング
1. [05_implementation/troubleshooting.md](05_implementation/troubleshooting.md) - 既知の問題と解決策
2. [02_architecture/techDecisions/developmentGuide.md](02_architecture/techDecisions/developmentGuide.md) - 開発環境の問題解決
3. [01_project/activeContext/issuesAndNotes.md](01_project/activeContext/issuesAndNotes.md) - 最新の問題と注意事項

## 📁 ディレクトリ構造

```
documents/
├── SUMMARY.md                   # プロジェクト全体サマリー
├── README.md                    # このファイル
│
├── 01_project/                  # プロジェクト管理
│   ├── summary.md              # カテゴリー概要
│   ├── projectbrief.md         # MVP要件
│   ├── activeContext/          # 現在の状況 📁
│   │   ├── index.md           # 現在のタスクと優先事項
│   │   ├── completedTasks.md  # 完了済みタスク
│   │   ├── developmentEnvironment.md # 開発環境
│   │   └── issuesAndNotes.md  # 問題と注意事項
│   └── progressReports/        # 進捗管理 📁
│       ├── index.md           # 進捗サマリー
│       ├── weeklyReports.md   # 週次レポート
│       ├── milestones.md      # マイルストーン
│       └── retrospective.md   # 振り返り
│
├── 02_architecture/             # システム設計
│   ├── summary.md              
│   ├── design_doc.md           # 詳細設計
│   ├── systemPatterns.md       # パターン
│   ├── techDecisions/          # 技術決定 📁
│   │   ├── index.md           # 技術コンテキスト概要
│   │   ├── techStack.md       # 技術スタック詳細
│   │   ├── implementationPatterns.md # 実装パターン
│   │   ├── developmentGuide.md # 開発ガイド
│   │   ├── productionGuide.md  # 本番環境ガイド
│   │   └── technicalDecisions.md # 技術的決定記録
│   └── api/                    # API仕様
│       ├── gemini_api_specification.md
│       └── ai_coordination_protocol.md
│
├── 03_worldbuilding/            # 世界観・ゲーム
│   ├── summary.md              
│   ├── world_design.md         # 世界設定
│   └── game_mechanics/         # メカニクス
│       ├── summary.md         
│       ├── basic.md           
│       └── log.md             
│
├── 04_ai_agents/                # AI仕様
│   ├── summary.md              
│   └── gm_ai_spec/             # 各AI詳細
│       ├── dramatist.md       
│       ├── state_manager.md   
│       ├── historian.md       
│       ├── npc_manager.md     
│       ├── the_world.md       
│       └── anomaly.md         
│
├── 05_implementation/           # 実装ガイド
│   ├── summary.md              
│   ├── characterManagementSummary.md
│   ├── productContext.md       
│   └── troubleshooting.md      
│
├── 06_reports/                  # レポート
│   ├── summary.md              
│   └── test_play_reports/      
│       └── test_play_report_1.md
│
└── assets/                      # 画像素材
    ├── logverse_keyvisual_v1.png
    └── logverse_logo_v1.jpg
```

## 🔗 クイックリンク

### 概要・サマリー
- **プロジェクト全体**: [SUMMARY.md](SUMMARY.md)
- **現在の状況**: [01_project/activeContext/index.md](01_project/activeContext/index.md)
- **進捗状況**: [01_project/progressReports/index.md](01_project/progressReports/index.md)

### 重要なドキュメント
- **MVP要件**: [01_project/projectbrief.md](01_project/projectbrief.md)
- **システム設計**: [02_architecture/design_doc.md](02_architecture/design_doc.md)
- **世界観設定**: [03_worldbuilding/world_design.md](03_worldbuilding/world_design.md)
- **技術スタック**: [02_architecture/techDecisions/techStack.md](02_architecture/techDecisions/techStack.md)

### 開発者向け
- **開発環境セットアップ**: [02_architecture/techDecisions/developmentGuide.md](02_architecture/techDecisions/developmentGuide.md)
- **実装パターン**: [02_architecture/techDecisions/implementationPatterns.md](02_architecture/techDecisions/implementationPatterns.md)
- **トラブルシューティング**: [05_implementation/troubleshooting.md](05_implementation/troubleshooting.md)