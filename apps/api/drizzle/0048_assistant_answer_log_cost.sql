ALTER TABLE "assistant_answer_log" ADD COLUMN "cost_micro_usd" integer;--> statement-breakpoint
ALTER TABLE "assistant_answer_log" ADD COLUMN "cached_tokens" integer;--> statement-breakpoint
ALTER TABLE "assistant_answer_log" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "assistant_answer_log" ADD COLUMN "web_searches" integer;--> statement-breakpoint
ALTER TABLE "assistant_answer_log" ADD COLUMN "unresolved_citations" integer DEFAULT 0 NOT NULL;
