/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
  // その他の環境変数があればここに追加
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}