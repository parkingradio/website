CREATE TABLE "youtube_credentials" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"channel_id" text NOT NULL,
	"api_key" text NOT NULL,
	"uploads_playlist_id" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "youtube_credentials_single_row" CHECK ("youtube_credentials"."id" = 1)
);
