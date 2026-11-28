-- What's read of a set's track goes with the set (#345, see "Reading the tracks" in docs/design/server/radio.md): it's
-- kept by set rather than by SoundCloud's id for the track, through the set's link only, and deleted with the set. The
-- reads through the link their set has are kept, so that the radio doesn't read the rotation's tracks again once it's
-- deployed. The others are dropped: those of deleted sets, and those through a link a set no longer has, private links
-- and their secrets included, which could never be used again. So no snapshot is needed before deploying it. Once it's
-- applied, an older server's rotation of sets fails (/api/on-air, /api/radio/sets/:id/stream and the admin pages of the
-- rotation), since it reads soundcloud_track_reads; the client doesn't call /api/on-air yet. A problem found afterwards is
-- fixed forward (see "Database migrations" in docs/deployment.md).
--
-- The schema changes are drizzle-kit's, but for the unique index on sets, which comes first here, since the foreign key
-- needs it, and the reads that are kept, which are copied by hand before the old table is dropped.
CREATE UNIQUE INDEX "sets_id_soundcloud_track_url_idx" ON "sets" USING btree ("id","soundcloud_track_url");--> statement-breakpoint
CREATE TABLE "set_track_reads" (
	"set_id" uuid PRIMARY KEY NOT NULL,
	"link" text NOT NULL,
	"state" text,
	"duration_ms" integer,
	"secret_token" text,
	"read_at" timestamp with time zone,
	"attempted_at" timestamp with time zone NOT NULL,
	"error" text,
	CONSTRAINT "set_track_reads_state" CHECK ("set_track_reads"."state" in ('playable', 'missing', 'unexpected', 'preview', 'blocked', 'not-streamable')),
	CONSTRAINT "set_track_reads_duration" CHECK ("set_track_reads"."duration_ms" > 0)
);
--> statement-breakpoint
ALTER TABLE "set_track_reads" ADD CONSTRAINT "set_track_reads_set_fk" FOREIGN KEY ("set_id","link") REFERENCES "public"."sets"("id","soundcloud_track_url") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
INSERT INTO "set_track_reads" ("set_id", "link", "state", "duration_ms", "secret_token", "read_at", "attempted_at", "error")
	SELECT "sets"."id", "reads"."link", "reads"."state", "reads"."duration_ms", "reads"."secret_token", "reads"."read_at", "reads"."attempted_at", "reads"."error"
	FROM "soundcloud_track_reads" AS "reads"
	JOIN "sets" ON "sets"."soundcloud_track_id" = "reads"."track_id" AND "sets"."soundcloud_track_url" = "reads"."link";--> statement-breakpoint
DROP TABLE "soundcloud_track_reads" CASCADE;
