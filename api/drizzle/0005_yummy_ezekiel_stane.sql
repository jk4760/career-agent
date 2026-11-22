CREATE TABLE "model_budget_days" (
	"budget_date" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
