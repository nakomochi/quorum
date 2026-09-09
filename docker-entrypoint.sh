#!/bin/sh
set -e

# マイグレーションは冪等（drizzle が __drizzle_migrations で適用済みを判定する）。
# 失敗したらここで落とす: スキーマが古いまま起動するより起動しないほうが安全。
node /app/scripts/migrate.js

exec "$@"
