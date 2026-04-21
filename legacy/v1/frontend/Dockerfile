# フロントエンドDockerfile - React + TypeScript + Vite
FROM node:18-alpine

# 作業ディレクトリの設定
WORKDIR /app

# パッケージファイルをコピー
COPY package*.json ./

# 依存関係をインストール
RUN npm ci --only=production=false

# アプリケーションコードをコピー
COPY . .

# 開発環境では権限問題を避けるためrootで実行
# 本番環境では別途セキュリティ設定を行う
RUN mkdir -p /app/node_modules/.vite && \
    chmod -R 755 /app

# ポートを公開
EXPOSE 3000

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000 || exit 1

# 開発サーバーを起動
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]