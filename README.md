# Quorum

Discord 認証つきのフォーム / 出欠管理アプリ

## 開発

```sh
direnv allow          # or nix develop
bun install
cp .env.example .env
bun run db:start
bunx drizzle-kit migrate
bun run dev           # http://localhost:5173
```

```sh
bun run check
bun run test
bun run build
```

リマインドや自動クローズは dev では動かない。`.env` に `CRON_SECRET` を入れて `bun run cron tick` で手動実行する。

設計は [`docs/architecture.md`](docs/architecture.md)。

## Discord Developer Portal

1. アプリを作成し、Client ID / Secret を `.env` へ
2. `OAuth2` → `Redirects` に `http://localhost:5173/api/auth/callback/discord`（本番は `https://<公開ドメイン>/api/auth/callback/discord` も）
3. Bot を作成し、トークンを `.env` へ
4. `Bot` → `Privileged Gateway Intents` → SERVER MEMBERS INTENT を ON
5. Bot を招待する

```
https://discord.com/oauth2/authorize?client_id=<CLIENT_ID>&scope=bot&permissions=216064&guild_id=<GUILD_ID>
```

## デプロイ（Coolify）

1. Postgres を別サービスで作る
2. アプリをこのリポジトリから作成する。Build Pack は Dockerfile、ポートは `3000`、レプリカは 1
3. 環境変数: `DATABASE_URL` / `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `ORIGIN` / `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` / `DISCORD_BOT_TOKEN` / `DISCORD_GUILD_ID` / `CRON_SECRET`
4. Scheduled Tasks に登録する

   | Command | Frequency |
   | --- | --- |
   | `node scripts/cron.js tick` | `* * * * *` |
   | `node scripts/cron.js sync-members` | `0 * * * *` |

マイグレーションはコンテナ起動時に自動で流れる。
