CREATE TABLE "assistant_answer_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"agent_message_id" uuid,
	"status" text NOT NULL,
	"error_class" text,
	"mode" text NOT NULL,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer NOT NULL,
	"llm_ms" integer,
	"vector_arm_empty" boolean NOT NULL,
	"unembedded_chunks" integer NOT NULL,
	"retrieved" jsonb NOT NULL,
	"sources" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "assistant_answer_log_created_at_idx" ON "assistant_answer_log" ("created_at");
