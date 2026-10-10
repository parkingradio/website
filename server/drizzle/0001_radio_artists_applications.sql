CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"artist_id" uuid NOT NULL,
	"dates" date[] NOT NULL,
	"time_slots" jsonb NOT NULL,
	"prestations" text[] NOT NULL,
	"other_prestation" text NOT NULL,
	"details" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone,
	"status" text DEFAULT 'new' NOT NULL,
	"status_updated_by" text,
	"status_updated_at" timestamp with time zone,
	CONSTRAINT "applications_status" CHECK ("applications"."status" in ('new', 'accepted', 'scheduled', 'done', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "applications_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"recipients" text[] NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "applications_settings_single_row" CHECK ("applications_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"members" text[] NOT NULL,
	"country" text NOT NULL,
	"city" text NOT NULL,
	"genres" text[] NOT NULL,
	"bio" text NOT NULL,
	"links" jsonb NOT NULL,
	"phone" text NOT NULL,
	"photo_key" text,
	"photo_type" text,
	"updated_by" text,
	"updated_at" timestamp with time zone,
	CONSTRAINT "artists_kind" CHECK ("artists"."kind" in ('artist', 'collective')),
	CONSTRAINT "artists_photo" CHECK (("artists"."photo_key" is null) = ("artists"."photo_type" is null))
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radio_on_air" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"playlist_id" text NOT NULL,
	"track_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"next_track_ids" text[] NOT NULL,
	CONSTRAINT "radio_on_air_single_row" CHECK ("radio_on_air"."id" = 1)
);
--> statement-breakpoint
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
CREATE TABLE "soundcloud_credentials" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "soundcloud_credentials_single_row" CHECK ("soundcloud_credentials"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_artist_id_idx" ON "applications" USING btree ("artist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "artists_email_lower_idx" ON "artists" USING btree (lower("email"));