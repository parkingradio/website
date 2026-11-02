-- Adds sessions, the occasions at the studio, their sets, the performers of each set, who are artists, and the
-- collective whose takeover each session is.
--
-- The schema changes are drizzle-kit's, except what's at the end, written by hand, since drizzle can't declare it: the
-- btree_gist extension, the function session_period, and the exclusion constraints that use them. Sessions with a start
-- can't overlap, and neither can the sets of a session that have an offset, unless one of them is cancelled. Ranges'
-- default bounds take a session, or a set, from its start, included, to its end, excluded, so they can follow each other.
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"start_at" timestamp with time zone,
	"duration_minutes" integer NOT NULL,
	"name" text NOT NULL,
	"takeover_id" uuid,
	"ra_event_id" text,
	"updated_by" text,
	"updated_at" timestamp with time zone,
	"status" text DEFAULT 'planned' NOT NULL,
	"status_updated_by" text,
	"status_updated_at" timestamp with time zone,
	CONSTRAINT "sessions_duration" CHECK ("sessions"."duration_minutes" between 1 and 1440),
	CONSTRAINT "sessions_status" CHECK ("sessions"."status" in ('planned', 'done', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "set_performers" (
	"set_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "set_performers_set_id_position_pk" PRIMARY KEY("set_id","position")
);
--> statement-breakpoint
CREATE TABLE "sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"session_id" uuid NOT NULL,
	"offset_minutes" integer,
	"duration_minutes" integer,
	"prestations" text[] NOT NULL,
	"other_prestation" text NOT NULL,
	"genres" text[] NOT NULL,
	"soundcloud_track_id" text,
	"soundcloud_track_url" text,
	"youtube_video_id" text,
	"updated_by" text,
	"updated_at" timestamp with time zone,
	"status" text DEFAULT 'planned' NOT NULL,
	"status_updated_by" text,
	"status_updated_at" timestamp with time zone,
	CONSTRAINT "sets_place" CHECK ("sets"."offset_minutes" is null or "sets"."duration_minutes" is not null),
	CONSTRAINT "sets_offset" CHECK ("sets"."offset_minutes" between 0 and 1439),
	CONSTRAINT "sets_duration" CHECK ("sets"."duration_minutes" between 1 and 1440),
	CONSTRAINT "sets_soundcloud_track" CHECK (("sets"."soundcloud_track_id" is null) = ("sets"."soundcloud_track_url" is null)),
	CONSTRAINT "sets_status" CHECK ("sets"."status" in ('planned', 'done', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_takeover_id_collectives_id_fk" FOREIGN KEY ("takeover_id") REFERENCES "public"."collectives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_performers" ADD CONSTRAINT "set_performers_set_id_sets_id_fk" FOREIGN KEY ("set_id") REFERENCES "public"."sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_performers" ADD CONSTRAINT "set_performers_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_takeover_id_idx" ON "sessions" USING btree ("takeover_id");--> statement-breakpoint
CREATE UNIQUE INDEX "set_performers_artist_id_set_id_idx" ON "set_performers" USING btree ("artist_id","set_id");--> statement-breakpoint
CREATE INDEX "sets_session_id_idx" ON "sets" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sets_soundcloud_track_id_idx" ON "sets" USING btree ("soundcloud_track_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sets_youtube_video_id_idx" ON "sets" USING btree ("youtube_video_id");--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
-- A session's period: from its start to its start plus its duration, in minutes that actually pass. Adding an interval
-- to a timestamptz is only stable, since adding days or months depends on the time zone, but adding minutes doesn't,
-- which lets an index use it. Strict, so that a session without a start has no period, rather than an unbounded one.
CREATE FUNCTION "session_period"("start_at" timestamp with time zone, "duration_minutes" integer) RETURNS tstzrange
	LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
	RETURN tstzrange("start_at", "start_at" + "duration_minutes" * interval '1 minute');--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_no_overlap" EXCLUDE USING gist (session_period("start_at", "duration_minutes") WITH &&) WHERE ("status" <> 'cancelled' AND "start_at" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_no_overlap" EXCLUDE USING gist ("session_id" WITH =, int4range("offset_minutes", "offset_minutes" + "duration_minutes") WITH &&) WHERE ("status" <> 'cancelled' AND "offset_minutes" IS NOT NULL);
