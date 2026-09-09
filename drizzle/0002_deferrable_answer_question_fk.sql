-- Custom SQL migration file, put your code below! --

-- The Drizzle schema DSL cannot express DEFERRABLE foreign keys, so the constraint
-- generated from schema.ts (ON DELETE NO ACTION, immediate) is recreated here.
--
-- Deleting a form cascades along two paths: form -> question and form -> response -> answer.
-- With an immediately-checked constraint (RESTRICT or plain NO ACTION) the question FK is
-- checked before the answer rows are removed, so any form that has at least one answer can
-- never be deleted. Deferring the check to commit time fixes the form delete while still
-- rejecting a bare `DELETE FROM question` (questions are soft-deleted via deleted_at).
ALTER TABLE "answer" DROP CONSTRAINT "answer_question_id_question_id_fk";
--> statement-breakpoint
ALTER TABLE "answer" ADD CONSTRAINT "answer_question_id_question_id_fk"
  FOREIGN KEY ("question_id") REFERENCES "public"."question"("id")
  ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
