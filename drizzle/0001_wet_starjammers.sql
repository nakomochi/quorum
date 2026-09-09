ALTER TABLE "answer" DROP CONSTRAINT "answer_question_id_question_id_fk";
--> statement-breakpoint
DROP INDEX "reminder_auto_once_uq";--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "target_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_closes_at_idx" ON "form" USING btree ("closes_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_auto_once_uq" ON "reminder" USING btree ("form_id","target_deadline") WHERE "reminder"."kind" = 'auto';