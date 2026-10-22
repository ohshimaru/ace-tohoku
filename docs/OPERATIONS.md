# 運用・公開手順

## 1. 公開環境の作り方（Vercel ＋ PostgreSQL）

Clean Up と同じ構成です。**作成・課金・APIキーの発行・本番公開は、利用者ご本人の操作／承認が必要です。**
キーやパスワードはチャット・コード・GitHub に書かず、Vercel の画面に直接入力してください。

1. **GitHub**: 新しい非公開リポジトリ（例: `ace-tohoku`）を作成し、このコードを push
2. **データベース**: Supabase で新しいプロジェクトを作成（Clean Up とは別のプロジェクト。リージョンは東京）
   - 接続文字列（Transaction pooler）→ `DATABASE_URL`、直結（Session / Direct）→ `MIGRATE_DATABASE_URL`
   - Storage で非公開バケット `private-files` を作成 → `SUPABASE_URL`・`SUPABASE_SERVICE_ROLE_KEY`・`STORAGE_DRIVER=supabase`
3. **Vercel**: 新しいプロジェクトとしてリポジトリを Import（Framework: Next.js、リージョン hnd1 は vercel.json で指定済み）
   - Environment Variables に `.env.example` の項目を設定（`APP_URL` は公開URL、`APP_SECRET`・`CRON_SECRET` はランダムな長い値、`TRUSTED_IP_HEADER=x-forwarded-for`）
4. **初回のDB準備**（手元のPCから、本番DBのURLを環境変数で渡して実行）
   ```bash
   MIGRATE_DATABASE_URL='…' pnpm db:migrate
   DATABASE_URL='…' pnpm db:seed
   DATABASE_URL='…' ADMIN_EMAIL=… ADMIN_NAME=… ADMIN_PASSWORD='…' pnpm admin:create
   ```
5. **定期処理**: vercel.json で毎日 9:00（日本時間）に `/api/cron` を実行（Hobby プランは1日1回まで）。
   リマインドを1日に複数回送る場合は Pro プランか外部の定期実行サービスから `Authorization: Bearer <CRON_SECRET>` で呼び出す
6. **LINE Login**: LINE Developers で「LINEログイン」チャネルを作成 → コールバックURL `https://<公開URL>/api/auth/line/callback` を登録 → `LINE_CHANNEL_ID`・`LINE_CHANNEL_SECRET` を設定（メッセージ配信は使いません）
7. **メール**: `EMAIL_DRIVER=resend`（または smtp）と `EMAIL_FROM` を設定。テスト中は `EMAIL_ALLOWLIST` で送信先を限定

### デモ環境として公開する場合（架空データのみ）

本番とは**別の** Vercel プロジェクト・DB を使います。`DEMO_LOGIN=true`・`DEMO_ENVIRONMENT=true` を設定し、
`DEMO_SEED_ALLOW=yes pnpm db:seed-demo` で架空データを入れます。デモログインは `@demo.invalid` のデモ用アカウントに限られ、
全画面に「デモデータ」と表示されます。**実データの本番では `DEMO_ENVIRONMENT` を設定しないでください。**

## 2. 日常の運用

| いつ | だれが | 何をする |
|---|---|---|
| 毎日 | 経営者 | ダッシュボードと「対応すること」を確認し、担当・期限を決める |
| 随時 | 責任者 | 経費・日報の承認、稼働希望の変更申請の処理 |
| 月末〜翌月初 | 責任者 | 翌月の稼働希望の受付開始 → 枠作成 → 自動割当 → 調整 → 確定 |
| 翌月初 | 経理 | 稼働明細の作成 → 確認 → 確定・公開（支払予定が作られる） |
| 随時 | 経理 | 銀行明細CSVの取込・照合、Clean Up の請求書CSV取込 |
| 月次 | 経理 | 月次締め（締めた月は変更不可。訂正は理由を記録して締め解除） |

## 3. データの保全

- 監査ログは削除・変更できません（DBトリガー）。確定済みの稼働明細の金額もDBで固定されます
- バックアップ: Supabase の自動バックアップ（プランに応じた保持期間）を有効にしてください。手動では `pg_dump` で取得できます
- 添付ファイルは非公開保存。閲覧のたびに権限を確認してから返します

## 4. 困ったとき

- 画面に「エラー番号: xxxx」が出たら、Vercel の Logs で同じ番号を検索（個人情報は記録していません）
- 銀行の同期失敗・メール送信失敗は、それぞれ「銀行口座」「メール送信」の画面で再試行できます
- ドライバーがログインできない: 「ドライバー」画面で状態（承認待ち・停止）と LINE 連携を確認。招待リンクは再発行できます
