CREATE TABLE "response_draft" (
	"form_id" text NOT NULL,
	"user_id" text NOT NULL,
	"answers" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "response_draft_form_id_user_id_pk" PRIMARY KEY("form_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "response_draft" ADD CONSTRAINT "response_draft_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "response_draft" ADD CONSTRAINT "response_draft_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;