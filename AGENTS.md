# AGENTS.md

- 設計と守るべき決まりは `docs/architecture.md` にある。サーバー側（`src/lib/server`、`src/routes` の `load` と action）を変える前に読むこと。
- 変更で `docs/architecture.md` に書いてあることが変わるなら、同じ変更でその文書も更新すること。

## コマンド

- `bun run check` — 型チェック
- `bun run lint` — Prettier の差分確認と ESLint
- `bun run format` — Prettier で整形
- `bun run test` — テスト（`bun run db:start` で DB を起動しておく。一時 DB を作って消す）
- `bun run build` — ビルド
