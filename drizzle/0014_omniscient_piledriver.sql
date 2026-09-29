ALTER TABLE "form" ADD COLUMN "announce_close" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "form" ADD COLUMN "close_notice_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "form" ADD COLUMN "close_message_id" text;--> statement-breakpoint
-- Forms closed before this migration count as handled, or the next tick would post their close now.
UPDATE "form" SET "close_notice_claimed_at" = "closed_at" WHERE "closed_at" IS NOT NULL;