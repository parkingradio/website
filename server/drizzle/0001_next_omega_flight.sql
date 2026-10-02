CREATE TABLE "radio_on_air" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"track_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"next_track_ids" text[] NOT NULL,
	CONSTRAINT "radio_on_air_single_row" CHECK ("radio_on_air"."id" = 1)
);
