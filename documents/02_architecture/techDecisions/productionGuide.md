# 本番環境ガイド - ゲスタロカ (Gestaloka)

このファイルには、本番環境へのデプロイメント、運用、セキュリティに関する情報が記載されています。

## セキュリティ考慮事項

### LLMプロンプトインジェクション対策

```python
def sanitize_user_input(text: str) -> str:
    # 制御文字の除去
    text = re.sub(r'[\x00-\x1F\x7F-\x9F]', '', text)
    
    # プロンプト区切り文字のエスケープ
    danger_patterns = [
        "###", "```", "System:", "Assistant:",
        "Human:", "<|", "|>"
    ]
    for pattern in danger_patterns:
        text = text.replace(pattern, "")
    
    # 長さ制限
    return text[:1000]
```

### API レート制限

```python
from slowapi import Limiter

limiter = Limiter(key_func=get_remote_address)

@app.post("/api/player/action")
@limiter.limit("30/minute")
async def player_action(request: Request, ...):
    pass
```

### WebSocket実装パターン

**Socket.IO選定理由:**
- 自動再接続機能
- ルーム機能によるプレイヤーグルーピング
- イベントベース通信

**実装構成:** ⏳ **準備完了**
- Socket.IO統合準備（FastAPI + Socket.IO）
- リアルタイムゲームイベント配信準備
- 認証統合（JWTトークン検証）

**実装パターン:**
```python
# サーバー側（app/websocket.py）
import socketio
from fastapi_socketio import SocketManager

sio = SocketManager(app=app)

@sio.on('player_action')
async def handle_player_action(sid, data):
    # JWT認証確認
    session = await get_session(sid)
    if not session:
        return {'error': 'Unauthorized'}
    
    # アクション処理をCeleryタスクキューに
    task = process_player_action.delay(
        session.player_id, 
        data
    )
    
    # 同じロケーションの他プレイヤーに通知
    await sio.emit(
        'world_update',
        {'player_id': session.player_id, 'action': data},
        room=f"location:{data.location_id}"
    )

# フロントエンド側（src/services/websocket.ts）
import { io, Socket } from 'socket.io-client'

class GameSocket {
  private socket: Socket
  
  connect(token: string) {
    this.socket = io(WS_URL, {
      auth: { token },
      transports: ['websocket']
    })
    
    this.socket.on('world_update', this.handleWorldUpdate)
    this.socket.on('story_response', this.handleStoryResponse)
  }
  
  sendAction(action: PlayerAction) {
    this.socket.emit('player_action', action)
  }
}
```

## デプロイメント・運用考慮事項

### 本番環境準備

**コンテナ最適化:**
```dockerfile
# マルチステージビルド（フロントエンド）
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

FROM nginx:alpine AS production
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf

# Pythonイメージ最適化（バックエンド）
FROM python:3.11-slim AS production
RUN pip install --no-cache-dir -r requirements.txt
USER nobody
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**環境変数管理:**
```bash
# 開発環境（.env.example）
ENVIRONMENT=development
DEBUG=true
LOG_LEVEL=DEBUG

# 本番環境（.env.production）
ENVIRONMENT=production
DEBUG=false
LOG_LEVEL=INFO
SECRET_KEY=<secure-random-key>
```

### 監視・ログ戦略

**構造化ログ:** ✅ **実装済み**
```python
import structlog

logger = structlog.get_logger()

# 構造化ログの例
logger.info(
    "Player action processed",
    player_id=player.id,
    action_type=action.type,
    location=action.location,
    duration=processing_time,
    success=True
)
```

**メトリクス収集準備:**
- Prometheus互換メトリクス（FastAPI integration）
- Custom metrics（ゲーム固有指標）
- アラート設定準備

### セキュリティ実装

**HTTPS/TLS:**
```nginx
# Nginx SSL設定（本番用）
server {
    listen 443 ssl http2;
    ssl_certificate /etc/ssl/certs/gestaloka.crt;
    ssl_certificate_key /etc/ssl/private/gestaloka.key;
    
    # セキュリティヘッダー
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
}
```

**API レート制限:** ✅ **準備済み**
```python
from slowapi import Limiter

# ユーザー行動制限
@limiter.limit("30/minute")  # 1分30アクション
async def player_action(request: Request, ...):
    pass

# AI生成制限
@limiter.limit("10/minute")  # 1分10回生成
async def generate_story(request: Request, ...):
    pass
```