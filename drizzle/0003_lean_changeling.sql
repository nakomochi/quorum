CREATE TABLE "guild_sync" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"last_full_sync_at" timestamp with time zone NOT NULL,
	CONSTRAINT "guild_sync_single_row" CHECK ("guild_sync"."id" = 1)
);
