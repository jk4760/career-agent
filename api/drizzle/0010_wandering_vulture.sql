CREATE TABLE "ai_message_saves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_type" text DEFAULT 'ai_message' NOT NULL,
	"conversation_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_message_saves_message_target_unique" UNIQUE("message_id","target_type")
);
--> statement-breakpoint
ALTER TABLE "ai_message_saves" ADD CONSTRAINT "ai_message_saves_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_saves" ADD CONSTRAINT "ai_message_saves_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_ai_message_saves_target" ON "ai_message_saves" USING btree ("target_type","target_id");