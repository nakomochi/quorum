# form-discord

Discord 認証つきのフォーム / 出欠管理アプリ

## セットアップ

```sh
direnv allow          # or nix develop
bun install
cp .env.example .env  # .env を設定する
docker compose up -d
bunx drizzle-kit migrate
bun run dev           # http://localhost:5173
```

`docker-compose.yml` は**開発用の Postgres 専用**。本番では使わない（本番の DB は Coolify 側で建てる）。

## 開発

```sh
bun run db:start
bun run test
```

テストは `.env` の `DATABASE_URL` と同じサーバーに実行ごとの一時 DB（`formdiscord_test_*`）を作り、
`drizzle/` のマイグレーションを当ててから走り、終わったら消す。開発用 DB の中身には触れない。
中断などで残った一時 DB は次の実行で消える。Discord への通信はすべてスタブで、外には出ない。

## 自動リマインド / 自動クローズ

アプリ内にタイマーは持たない。外部 cron（本番は Coolify Scheduled Tasks）が
`scripts/cron.js` 経由で `POST /internal/cron/<job>` を叩く（`Authorization: Bearer $CRON_SECRET`）。

| job | 間隔 | 内容 |
| --- | --- | --- |
| `tick` | 5 分 | 締切 24 時間前を過ぎたフォームに自動リマインドを送り、受付終了時刻を過ぎたフォームを閉じる |
| `sync-members` | 1 日 | サーバーメンバーの名簿を全件同期する |

同じ job が実行中なら 409 を返して何もしない。開発環境では自動で動かないので、
`.env` に `CRON_SECRET` を入れて dev サーバーを起動し、`bun run cron tick` で手動実行する。

名簿の更新・認可・ロックの決まりは [`docs/architecture.md`](docs/architecture.md) にまとめてある。

### Discord Developer Portal

1. アプリを作成 → Client ID / Secret を `.env` へ
2. `OAuth2` → `Redirects` に `http://localhost:5173/api/auth/callback/discord`
3. Bot を作成 → トークンを `.env` へ
4. `Bot` → `Privileged Gateway Intents` → SERVER MEMBERS INTENT を ON
5. Bot を招待　スコープは `bot` のみ　権限 `84992`
   （View Channels / Send Messages / Embed Links / Read Message History）

```
https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot&permissions=84992&guild_id=<GUILD_ID>
```

## デプロイ（Coolify）

1. **Postgres** を Coolify のデータベースとして別サービスで作る。内部接続文字列を控える。
2. **アプリ**をこのリポジトリから作成し、Build Pack に **Dockerfile** を選ぶ。ポートは `3000`。
3. 環境変数を9つ入れる（`POSTGRES_PASSWORD` は開発用 compose 専用なので不要）。
   `DATABASE_URL` / `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `ORIGIN` /
   `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` /
   `CRON_SECRET`
4. Discord Developer Portal の `OAuth2` → `Redirects` に
   `https://<公開ドメイン>/api/auth/callback/discord` を追加する。
5. **レプリカ数は 1 のまま**にする（起動時マイグレーションが単一インスタンス前提。下記）。
6. アプリの `Scheduled Tasks` に2件登録する。Container はアプリのコンテナのまま。

   | Command | Frequency |
   | --- | --- |
   | `node scripts/cron.js tick` | `*/5 * * * *` |
   | `node scripts/cron.js sync-members` | `0 19 * * *` |

   cron 式はサーバー設定の Server Timezone で解釈される。UTC なら `0 19 * * *` が JST 4:00。
   アプリコンテナが止まっている間のタスクはスキップされる。日次同期はその日の分が飛び、翌日に追いつく。

ビルドに秘密情報は要らない（`$env/dynamic/private` は実行時に読む）。ビルド引数に DB や
トークンを渡さないこと。

### 落とし穴

| 症状 | 原因 |
| --- | --- |
| フォーム送信・ログインの POST が全部 403 | `ORIGIN` が公開 URL と一致していない。adapter-node は `ORIGIN` で Origin ヘッダを検査する。スキーム・ホスト・ポートまで完全一致（末尾スラッシュなし） |
| ログインが `/api/auth/*` で 404 / redirect_uri mismatch | `BETTER_AUTH_URL` が公開 URL と違う、または Portal の Redirects に本番 URL を足していない |
| cron の実行が全部 401 / `CRON_SECRET is not set` | `CRON_SECRET` が Runtime の環境変数に入っていないか、値が一致しない。未設定のときエンドポイントは常に拒否する |
| 起動直後に `DATABASE_URL is not set` で落ちる | 環境変数がビルド時ではなく実行時に必要。Coolify 側で Runtime に入っているか確認する |

### マイグレーション

**コンテナ起動時に自動実行**する（`docker-entrypoint.sh` → `scripts/migrate.js` → `node build`）。
理由は、Coolify では単一インスタンスなので同時実行の心配がなく、drizzle は `__drizzle_migrations`
で適用済みを判定するため冪等で、手動運用だと流し忘れたときにスキーマの古いままアプリが起動して
しまうため。マイグレーションが失敗したらコンテナは起動しない。

`drizzle-kit` は devDependency なので実行イメージには入っていない。代わりに `drizzle/` を
イメージに同梱し、`drizzle-orm/postgres-js/migrator` の `migrate()` を `scripts/migrate.js` から
直接呼ぶ（依存は本番依存の `drizzle-orm` と `postgres` だけ）。