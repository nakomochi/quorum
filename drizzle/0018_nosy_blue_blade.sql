DROP INDEX "form_target_role_id_idx";--> statement-breakpoint
CREATE INDEX "form_created_at_id_idx" ON "form" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "form_created_by_created_at_id_idx" ON "form" USING btree ("created_by","created_at","id");--> statement-breakpoint
CREATE INDEX "reminder_form_sent_at_id_idx" ON "reminder" USING btree ("form_id","sent_at","id");--> statement-breakpoint
CREATE INDEX "response_user_submitted_at_id_idx" ON "response" USING btree ("user_id","submitted_at","id");