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