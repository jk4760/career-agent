CREATE TABLE "feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"action" text NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_events_action_check" CHECK ("feedback_events"."action" IN ('interested','pass','applied'))
);
--> statement-breakpoint
CREATE TABLE "interview_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text,
	"question" text NOT NULL,
	"answer_draft" text,
	"linked_material_id" uuid,
	"confidence" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"location" text,
	"salary_min" integer,
	"salary_max" integer,
	"currency" text DEFAULT 'CNY',
	"source" text NOT NULL,
	"source_url" text NOT NULL,
	"description" text,
	"posted_at" date,
	"collected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dedup_key" text NOT NULL,
	CONSTRAINT "jobs_dedup_key_unique" UNIQUE("dedup_key")
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project" text NOT NULL,
	"title" text NOT NULL,
	"role" text,
	"duration" text,
	"capability_l1" text,
	"capability_l2" text,
	"tags" text[],
	"facets" text[],
	"metrics" text,
	"content" text,
	"attachments" jsonb,
	"others" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "materials_project_title_key" UNIQUE("project","title")
);
--> statement-breakpoint
CREATE TABLE "preferences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"industries" text[],
	"roles" text[],
	"locations" text[],
	"salary_min" integer,
	"keywords_include" text[],
	"keywords_exclude" text[],
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid,
	"channel" text NOT NULL,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_reply" text
);
--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_linked_material_id_materials_id_fk" FOREIGN KEY ("linked_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_log" ADD CONSTRAINT "push_log_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_feedback_job" ON "feedback_events" USING btree ("job_id","created_at" DESC NULLS LAST);