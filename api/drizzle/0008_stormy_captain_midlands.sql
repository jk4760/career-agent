CREATE TABLE "report_push_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"input_hash" text NOT NULL,
	"pushed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"version" text NOT NULL,
	"hash" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_strategy_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"report" jsonb,
	"input_hash" text NOT NULL,
	"selection" jsonb NOT NULL,
	"source_job_ids" jsonb NOT NULL,
	"model" text NOT NULL,
	"usage_request_id" uuid,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "resume_strategy_reports_version_key" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "resume_strategy_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"selection" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_push_log" ADD CONSTRAINT "report_push_log_report_id_resume_strategy_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."resume_strategy_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_source_snapshots" ADD CONSTRAINT "report_source_snapshots_report_id_resume_strategy_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."resume_strategy_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_report_snapshots_report" ON "report_source_snapshots" USING btree ("report_id");