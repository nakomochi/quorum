CREATE TABLE "form_draft" (
	"id" text PRIMARY KEY NOT NULL,
	"created_by" text NOT NULL,
	"form_id" text,
	"payload" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_draft" ADD CONSTRAINT "form_draft_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_draft" ADD CONSTRAINT "form_draft_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_draft_created_by_idx" ON "form_draft" USING btree ("created_by");