CREATE TABLE "model_budget_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_date" text NOT NULL,
	"threshold" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_budget_alerts_date_threshold_key" UNIQUE("budget_date","threshold")
);
--> statement-breakpoint
CREATE TABLE "model_usage_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"budget_date" text NOT NULL,
	"purpose" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" text NOT NULL,
	"estimated_input_tokens" integer NOT NULL,
	"max_completion_tokens" integer NOT NULL,
	"reserved_amount" numeric(14, 6) NOT NULL,
	"input_tokens" integer,
	"cache_hit_tokens" integer,
	"cache_write_tokens" integer,
	"cache_ttl" text,
	"output_tokens" integer,
	"actual_amount" numeric(14, 6),
	"business_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "model_usage_requests_request_id_unique" UNIQUE("request_id")
);
--> statement-breakpoint
CREATE INDEX "idx_model_usage_budget_date" ON "model_usage_requests" USING btree ("budget_date","status");