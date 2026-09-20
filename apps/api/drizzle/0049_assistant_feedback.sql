CREATE TABLE "assistant_feedback" (
	"message_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"verdict" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_feedback_verdict_check" CHECK ("verdict" in ('up', 'down'))
);
--> statement-breakpoint
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_feedback" ADD CONSTRAINT "assistant_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_feedback" ENABLE ROW LEVEL SECURITY;
