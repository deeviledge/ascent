# サロン LINE コンシェルジュ

個人サロン（エステ・ネイル・まつげ）向けの LINE 一次応答 SaaS。
お客様から届いた LINE に AI が一次返信し、判断が要るものだけスタッフのグループトークへ流す。

月額 3,980 円で成立させるため、**固定費が出ない構成**にしてある。
アクセスがあったときだけ動くエッジ実行＋サーバーレス DB で、常時起動のサーバーは 1 台も無い。

```
LINE（サロンごとの公式アカウント）
        │  Webhook（署名付き）
        ▼
Cloudflare Workers + Hono          ← 実行環境。無料枠 10万リクエスト/日
        ├── Cloudflare D1（SQLite）  ← 契約情報・会話履歴・AI利用量
        └── Anthropic API           ← 一次返信の生成（軽量モデル + 月間上限）
        │
        ├── LINE reply  → お客様へ自動返信（LINE の無料返信枠）
        └── LINE push   → スタッフグループへ転送

管理画面 / LP（静的ファイル）      ← Vercel / Cloudflare Pages の無料枠
```

## 何をするツールか

1. お客様が LINE を送る
2. NG ワードを含むか判定 → 含めば AI を呼ばずスタッフへ
3. 月間 AI 上限の残枠を確保（超えていれば AI を呼ばずスタッフへ）
4. 直近 10 件の会話＋サロン設定（営業時間・メニュー・FAQ）を渡して返信を生成
5. 「予約の確定・変更」「料金交渉」「体調やリスクの相談」と判断したら返信せずスタッフへ
6. それ以外はその場で返信し、スタッフグループにも「AI が自動返信しました」と流す

3・5 がこのツールの肝で、**原価の暴走と、AI が答えてはいけないことに答える事故の両方をここで止めている**。

## ディレクトリ

| パス | 中身 |
|---|---|
| `src/index.ts` | Worker のエントリ。CORS、ルーティング、日次クリーンアップの cron |
| `src/routes/webhook.ts` | LINE Webhook。署名検証 → 冪等化 → 応答 → 転送 |
| `src/routes/admin.ts` | 管理画面 API（サインアップ / ログイン / 設定 / 会話閲覧 / 利用量） |
| `src/lib/ai.ts` | システムプロンプト組み立てと Anthropic 呼び出し |
| `src/lib/line.ts` | LINE の署名検証と Messaging API |
| `src/lib/db.ts` | D1 アクセス。AI 上限の原子的な確保もここ |
| `src/lib/crypto.ts` | トークン暗号化・パスワードハッシュ・セッション署名（WebCrypto のみ） |
| `migrations/0001_init.sql` | D1 スキーマ |
| `admin/` | 管理画面（ビルド不要の静的ファイル） |
| `lp/` | LP（静的ファイル） |
| `test/` | vitest。`node:sqlite` を D1 互換シムに被せて SQL ごと検証している |

## セットアップ

```bash
npm install

# D1 を作り、出力された database_id を wrangler.toml に書く
npx wrangler d1 create salon
npx wrangler d1 migrations apply salon --local     # ローカル
npx wrangler d1 migrations apply salon --remote    # 本番

# シークレット（wrangler.toml には書かない）
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put ENC_KEY        # openssl rand -base64 32
npx wrangler secret put AUTH_SECRET    # openssl rand -base64 32

npm run dev        # ローカル。.dev.vars.example を .dev.vars にコピーして使う
npm test           # 55 テスト
npm run typecheck
npm run deploy
```

管理画面と LP は静的ファイルなので、`admin/` `lp/` をそのまま Vercel か Cloudflare Pages に置く。
デプロイ先のオリジンを `wrangler.toml` の `ALLOWED_ORIGINS` に足すこと（CORS）。

## サロン側の初期設定（15分）

1. 管理画面から「はじめて使う」でアカウント作成
2. LINE Developers でチャネルシークレットと長期アクセストークンを取得し、管理画面に貼る
3. 管理画面に表示された Webhook URL（`https://<worker>/line/webhook/<tenant_id>`）を LINE 側に貼る
4. スタッフのグループトークにボットを招待し、グループ ID を管理画面に登録
5. 営業時間・メニュー・FAQ・NG ワードを入力

問い合わせ工数がそのままサポート原価になるので、この 5 手順は動画マニュアルにしておく。

## 原価

### 固定費

| 項目 | プラン | 月額 |
|---|---|---|
| Cloudflare Workers | 無料枠（10万リクエスト/日） | 0 円 |
| Cloudflare D1 | 無料枠（5GB / 500万行読み・10万行書き per day） | 0 円 |
| Vercel or Cloudflare Pages | Hobby / 無料枠 | 0 円 |

全テナントで割り勘になるので、**1 サロンあたりの固定費はほぼゼロ**。
無料枠を割ったとしても Workers Paid は $5/月（約 800 円）で数百万リクエストを捌けるので、
サロンが増えても固定費は跳ねない。

### 変動費（AI）

既定モデルは `claude-haiku-4-5`（$1 / 100万入力トークン、$5 / 100万出力トークン）。
1 回の一次応答はおよそ 入力 1,200 トークン／出力 150 トークン。

| | 計算 | 金額 |
|---|---|---|
| 1回あたり | 1,200/1M × $1 + 150/1M × $5 | 約 $0.002（約 0.3 円） |
| 上限まで使った月（300回） | $0.002 × 300 | **約 $0.59（約 90 円）** |

月額 3,980 円に対して、最大まで使われても AI 原価は約 90 円。
`ai_quota_monthly` を上げ下げすればこの上限はそのまま動く（管理画面からではなく DB 側の値）。

### 注意：LINE の送信料はサロン持ち

スタッフグループへの転送は LINE の **push** メッセージで、公式アカウントの無料枠は月 200 通。
お客様への返信は **reply** なので無料枠を消費しない。
サロンごとに自分の公式アカウントを使う構成なので、この費用は当社の原価ではなくサロン側の負担になる。
それでも「転送が多いサロンは LINE 側の課金が要る」ことは、売る前に伝えておくこと。

## 設計上、意図してそうしていること

- **秘密情報は必ず暗号化して保存する。** LINE のチャネルシークレットとアクセストークンは AES-GCM で暗号化して D1 に入れ、API では一切返さない（接続済みかどうかだけ返す）。
- **AI 上限は SQL の `WHERE` で止める。** `UPDATE ... WHERE used_count < quota` を使うので、Webhook が同時に来ても上限を超えて課金されない。AI 呼び出しに失敗したときは枠を戻す。
- **Webhook は署名検証だけ同期で行い、実処理は `waitUntil` に逃がす。** LINE 側のタイムアウトを避けるため。
- **同じイベントは 1 回しか処理しない。** LINE は Webhook を再送するので `webhookEventId` で冪等化し、その表は日次 cron で 7 日ぶん残して掃除する。
- **拡張思考は使わない。** 一次応答には過剰で、出力トークン＝原価が増えるだけ。
- **1:1 トーク以外は転送しない。** スタッフグループ内の発言に反応して無限ループになるのを防ぐ。

## これから足すもの

- 決済（Stripe）と契約状態の連動：いまは `tenants.status` を手で動かす前提
- スタッフからの返信を管理画面から送る（いまは閲覧のみ）
- 予約システム連携（空き枠を見て答える）
