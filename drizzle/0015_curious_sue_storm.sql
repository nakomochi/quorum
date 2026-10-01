ALTER TABLE "form_draft" DROP CONSTRAINT "form_draft_form_id_form_id_fk";
--> statement-breakpoint
ALTER TABLE "form" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "form_draft" ADD COLUMN "base_version" integer;--> statement-breakpoint
ALTER TABLE "form_draft" ADD CONSTRAINT "form_draft_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "form_draft_edit_uq" ON "form_draft" USING btree ("form_id","created_by") WHERE "form_draft"."form_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "form_draft" ADD CONSTRAINT "form_draft_edit_base" CHECK (("form_draft"."form_id" IS NULL) = ("form_draft"."base_version" IS NULL));