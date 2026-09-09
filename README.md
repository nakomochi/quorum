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

## 自動リマインド / 自動クローズ

`src/lib/server/scheduler.ts` の tick をアプリ内 `setInterval` で 5 分ごとに回す。締切 24 時間前を
過ぎたフォームに自動リマインドを送り、受付終了時刻を過ぎたフォームを閉じる。
外部 cron（Coolify Scheduled Tasks 等）に移す場合は `runTick()` をそのまま呼べばよい。

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
3. 環境変数を8つ入れる（`POSTGRES_PASSWORD` は開発用 compose 専用なので不要）。
   `DATABASE_URL` / `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `ORIGIN` /
   `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID`
4. Discord Developer Portal の `OAuth2` → `Redirects` に
   `https://<公開ドメイン>/api/auth/callback/discord` を追加する。
5. **レプリカ数は 1 のまま**にする。

ビルドに秘密情報は要らない（`$env/dynamic/private` は実行時に読む）。ビルド引数に DB や
トークンを渡さないこと。

### 落とし穴

| 症状 | 原因 |
| --- | --- |
| フォーム送信・ログインの POST が全部 403 | `ORIGIN` が公開 URL と一致していない。adapter-node は `ORIGIN` で Origin ヘッダを検査する。スキーム・ホスト・ポートまで完全一致（末尾スラッシュなし） |
| ログインが `/api/auth/*` で 404 / redirect_uri mismatch | `BETTER_AUTH_URL` が公開 URL と違う、または Portal の Redirects に本番 URL を足していない |
| 自動リマインドが同じフォームに複数回飛ぶ | レプリカが2つ以上ある。スケジューラはプロセス内 `setInterval` なので、レプリカごとに tick が回る（→ 常に1インスタンス） |
| 起動直後に `DATABASE_URL is not set` で落ちる | 環境変数がビルド時ではなく実行時に必要。Coolify 側で Runtime に入っているか確認する |

### マイグレーション

**コンテナ起動時に自動実行**する（`docker-entrypoint.sh` → `scripts/migrate.js` → `node build`）。
理由は、Coolify では単一インスタンスなので同時実行の心配がなく、drizzle は `__drizzle_migrations`
で適用済みを判定するため冪等で、手動運用だと流し忘れたときにスキーマの古いままアプリが起動して
しまうため。マイグレーションが失敗したらコンテナは起動しない。

`drizzle-kit` は devDependency なので実行イメージには入っていない。代わりに `drizzle/` を
イメージに同梱し、`drizzle-orm/postgres-js/migrator` の `migrate()` を `scripts/migrate.js` から
直接呼ぶ（依存は本番依存の `drizzle-orm` と `postgres` だけ）。