ALTER TABLE "feedback_events" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "llm_eval" jsonb;--> statement-breakpoint
ALTER TABLE "preferences" ADD COLUMN "background_text" text;