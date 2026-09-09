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