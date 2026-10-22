# Slack 連携の設定

できること

1. **毎日の要約**：毎朝 9:00（日本時間）に、AI社員の動き（新しい指摘・自動で閉じた指摘・人が完了した指摘）、今日のタスク（期限切れ・今日・今週を担当者別）、昨日の業務の件数、今月の売上・利益を Slack に投稿
2. **`/ai` で Claude に依頼**：Slack で `/ai 〇〇して` と送ると Claude が作業し、終わったら同じチャンネルに結果が届く

秘密の値（Webhook URL・Signing Secret・トークン）は、チャットやコードに書かず、**Vercel の環境変数に直接入力**してください。

---

## 1. Slack アプリを作る（5分）

1. https://api.slack.com/apps → **Create New App** → **From a manifest** → ワークスペースを選ぶ
2. 次の内容を貼り付けて **Create**

```yaml
display_information:
  name: 経営ナビ
  description: エースナンバー東北の経営ナビ（毎日の要約と AI への依頼）
features:
  bot_user:
    display_name: 経営ナビ
    always_online: true
  slash_commands:
    - command: /ai
      url: https://ace-tohoku.vercel.app/api/slack/command
      description: Claude に仕事を頼む（終わったらこのチャンネルに結果が届きます）
      usage_hint: 来月のドライバー募集の文章を3案つくって
      should_escape: false
oauth_config:
  scopes:
    bot:
      - commands
      - incoming-webhook
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

3. **Install to Workspace** → 要約を投稿するチャンネル（例：#経営ナビ）を選んで **許可する**
4. 次の2つを控える（画面で表示・コピーするだけ。チャットには貼らない）
   - **Incoming Webhooks** → Webhook URL（`https://hooks.slack.com/services/…`）
   - **Basic Information** → App Credentials → **Signing Secret**

## 2. Claude 側の準備（API で起動できるようにする）

定期タスク「経営ナビ Slackからの依頼（エースナンバー東北）」を作成済みです（時刻では動かず、Slack から呼ばれたときだけ動きます）。

1. https://claude.ai/code/routines でこのタスクを開く
2. **Add another trigger**（トリガーを追加）→ **API** → **Generate token**
   - 表示される **URL**（`https://api.anthropic.com/v1/claude_code/routines/trig_…/fire`）と **トークン**（1回だけ表示）を控える
3. 不要なコネクタ（Stripe・Typefully など）は、タスクの設定から外しておくと安心です（このタスクは調べもの・下書きだけを行う指示になっています）
4. **ネットワークの許可**：Claude の作業環境から結果をアプリに送るため、claude.ai の **設定 → 機能（Capabilities）** のネットワーク許可（または Claude Code の環境設定のネットワーク許可）に `ace-tohoku.vercel.app` を追加。これをしないと、作業は終わっても結果が Slack に届きません（タスク画面の履歴に「実行中」のまま残ります）

> 利用量は Max プランの使用枠から消費されます。上限は 1つのタスクにつき1時間30回・アカウント全体で1時間100回です。

## 3. Vercel に入力する

Vercel → プロジェクト `ace-tohoku` → **Settings → Environment Variables**（Production）に追加

| 名前 | 値 |
|---|---|
| `SLACK_WEBHOOK_URL` | 手順1の Webhook URL |
| `SLACK_SIGNING_SECRET` | 手順1の Signing Secret |
| `ROUTINE_FIRE_URL` | 手順2の URL |
| `ROUTINE_FIRE_TOKEN` | 手順2のトークン |
| `CRON_SECRET` | 自分で作った長いランダムな文字列（毎朝の定期処理の認証用） |
| `SLACK_ALLOWED_USER_IDS` | （任意）`/ai` を使える人の Slack ユーザーID（カンマ区切り） |

入力後、**Deployments → 最新 → Redeploy** で反映します。

## 4. 確認

- アプリに経営者でログイン → **タスク** 画面 → 「今すぐ Slack に送ってみる」→ Slack に要約が届く
- Slack で `/ai こんにちは。今日の天気に合わせた朝礼のひと言を考えて` → 「受け付けました」→「作業を始めました」→ 数分後に結果
- 依頼の履歴はタスク画面の下（経営者のみ）に表示されます

## しくみと安全のための決まり

- `/ai` は Slack の署名を確認し、5分以上前のリクエストや改ざんされたものは受け付けません
- Claude が結果を送るときは、依頼ごとの専用の合言葉が必要です（他の依頼の結果を書き換えられません）。同じ依頼の結果は1回だけ投稿されます
- Claude は支払い・契約・予算変更・送信・削除を行いません（下書きや手順として返すだけ）
- Slack に送る要約は件数・タイトル・合計金額までで、ドライバーの連絡先などの個人情報は含めません。`/ai` で Claude に渡るのは依頼文と依頼者の表示名だけです
