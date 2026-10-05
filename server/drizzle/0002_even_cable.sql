CREATE TABLE "radio_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"playlist_id" text NOT NULL,
	"playlist_secret_token" text,
	"playlist_url" text NOT NULL,
	"playlist_title" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "radio_settings_single_row" CHECK ("radio_settings"."id" = 1)
);
--> statement-breakpoint
-- The track on air was from the rotation of every track of an account, which is gone: the radio goes back
-- on air once a playlist is chosen.
DELETE FROM "radio_on_air";--> statement-breakpoint
ALTER TABLE "radio_on_air" ADD COLUMN "playlist_id" text NOT NULL;