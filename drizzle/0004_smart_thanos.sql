-- The existing row has no owner or roles to satisfy NOT NULL. Dropping it keeps "a row exists"
-- meaning "a complete snapshot exists"; the next full sync writes it back.
DELETE FROM "guild_sync";--> statement-breakpoint
ALTER TABLE "guild_sync" ADD COLUMN "owner_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "guild_sync" ADD COLUMN "roles" jsonb NOT NULL;