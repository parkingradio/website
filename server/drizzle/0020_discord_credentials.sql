CREATE TABLE "discord_credentials" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"bot_token" text NOT NULL,
	"channel_id" text NOT NULL,
	"bot_name" text NOT NULL,
	"channel_name" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "discord_credentials_single_row" CHECK ("discord_credentials"."id" = 1)
);
