-- serial -> identity. drizzle-kit only emits the ADD IDENTITY, which fails while the serial
-- default and its sequence (same name as the identity's) still exist, so remove those first.
ALTER TABLE "response_revision" ALTER COLUMN "id" DROP DEFAULT;--> statement-breakpoint
DROP SEQUENCE "response_revision_id_seq";--> statement-breakpoint
ALTER TABLE "response_revision" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (sequence name "response_revision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1);--> statement-breakpoint
-- The new identity starts at 1; continue after the existing rows (1 when the table is empty).
SELECT setval(pg_get_serial_sequence('response_revision', 'id'), coalesce(max("id"), 0) + 1, false) FROM "response_revision";