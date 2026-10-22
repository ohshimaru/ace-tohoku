CREATE TABLE "slack_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_user_id" text NOT NULL,
	"slack_user_name" text DEFAULT '' NOT NULL,
	"channel_id" text NOT NULL,
	"text" text NOT NULL,
	"response_url" text,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"session_url" text,
	"result" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
