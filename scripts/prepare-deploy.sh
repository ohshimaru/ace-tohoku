#!/usr/bin/env bash
# Vercel のビルド時に実行: マイグレーション → 初期データ →（デモ環境なら）デモデータ → ビルド
# どれも何度実行しても重複しない
set -euo pipefail
if [ -z "${DATABASE_URL:-}${POSTGRES_URL:-}" ]; then
  echo "データベースが未設定です。Vercel の Storage でデータベースを作成し、このプロジェクトに接続してください。" >&2
  exit 1
fi
pnpm exec tsx scripts/migrate.ts
pnpm exec tsx --conditions=react-server scripts/seed-initial.ts
if [ "${DEMO_ENVIRONMENT:-}" = "true" ]; then
  DEMO_SEED_ALLOW=yes pnpm exec tsx --conditions=react-server scripts/seed-demo.ts
fi
pnpm exec next build
