-- Adds the radio's rotation of sets (see "The rotation of sets" in docs/design/server/radio.md): its sets, in order, who
-- last changed it and the set on air on it, and what was read from SoundCloud of their tracks. It only adds tables, so
-- older servers go on working once it's applied, and nothing is removed, so no snapshot is needed before deploying it.
--
-- The schema changes are drizzle-kit's, but for the single row of radio_rotation, which is inserted by hand, so that
-- changing what's on air can always lock it.
CREATE TABLE "radio_rotation" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone,
	"on_air_set_id" uuid,
	"on_air_track_id" text,
	"on_air_started_at" timestamp with time zone,
	"on_air_position" integer,
	CONSTRAINT "radio_rotation_single_row" CHECK ("radio_rotation"."id" = 1),
	CONSTRAINT "radio_rotation_on_air" CHECK (("radio_rotation"."on_air_set_id" is null) = ("radio_rotation"."on_air_track_id" is null) and ("radio_rotation"."on_air_set_id" is null) = ("radio_rotation"."on_air_position" is null) and ("radio_rotation"."on_air_set_id" is not null or "radio_rotation"."on_air_started_at" is null))
);
--> statement-breakpoint
CREATE TABLE "rotation_sets" (
	"set_id" uuid PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "rotation_sets_position" CHECK ("rotation_sets"."position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "soundcloud_track_reads" (
	"track_id" text PRIMARY KEY NOT NULL,
	"link" text NOT NULL,
	"state" text,
	"duration_ms" integer,
	"secret_token" text,
	"read_at" timestamp with time zone,
	"attempted_at" timestamp with time zone NOT NULL,
	"error" text,
	CONSTRAINT "soundcloud_track_reads_state" CHECK ("soundcloud_track_reads"."state" in ('playable', 'missing', 'unexpected', 'preview', 'blocked', 'not-streamable')),
	CONSTRAINT "soundcloud_track_reads_duration" CHECK ("soundcloud_track_reads"."duration_ms" > 0)
);
--> statement-breakpoint
ALTER TABLE "rotation_sets" ADD CONSTRAINT "rotation_sets_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rotation_sets_position_idx" ON "rotation_sets" USING btree ("position");--> statement-breakpoint
INSERT INTO "radio_rotation" ("id") VALUES (1);
