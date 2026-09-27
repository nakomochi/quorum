CREATE TABLE "response_revision" (
	"id" serial PRIMARY KEY NOT NULL,
	"response_id" integer NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "response_revision" ADD CONSTRAINT "response_revision_response_id_response_id_fk" FOREIGN KEY ("response_id") REFERENCES "public"."response"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "response_revision_response_id_idx" ON "response_revision" USING btree ("response_id");--> statement-breakpoint
-- Backfill: each existing response gets its current answers as revision 1, stamped with its
-- last change. A response with no answers gets an empty object.
INSERT INTO "response_revision" ("response_id", "answers", "created_at")
SELECT
	r."id",
	coalesce(
		(SELECT jsonb_object_agg(a."question_id"::text, a."value") FROM "answer" a WHERE a."response_id" = r."id"),
		'{}'::jsonb
	),
	coalesce(r."updated_at", r."submitted_at")
FROM "response" r
ORDER BY r."id";