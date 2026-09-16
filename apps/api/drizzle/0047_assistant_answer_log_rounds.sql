ALTER TABLE "assistant_answer_log" ADD COLUMN "rounds" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_answer_log" ADD COLUMN "capped" boolean DEFAULT false NOT NULL;
