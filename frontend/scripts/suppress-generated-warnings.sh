#!/bin/bash

# 自動生成ファイルに @ts-nocheck を追加するスクリプト

GENERATED_DIR="src/api/generated"

# api ディレクトリ内のすべての .ts ファイルを処理
find "$GENERATED_DIR/api" -name "*.ts" -type f | while read -r file; do
  # すでに @ts-nocheck が含まれているかチェック
  if ! grep -q "@ts-nocheck" "$file"; then
    # ファイルの最初に @ts-nocheck を追加
    sed -i '1s/^/\/\/ @ts-nocheck\n/' "$file"
    echo "Added @ts-nocheck to: $file"
  fi
done

echo "Completed suppressing warnings in generated files"