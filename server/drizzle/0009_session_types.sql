-- Gives every session a type, which gives it its name, and keeps its name only as its own, when it's not the one its type
-- gives it (see "Types and names" in docs/design/server/sessions.md). Only takeovers have a collective, and they always
-- do, so a collective can't be deleted while it has takeovers anymore. Older servers can still read and change sessions
-- once it's applied, but not add one, which needs a type, or make a change the new checks refuse, or delete a collective
-- that has takeovers.
--
-- The schema changes are drizzle-kit's, but for the column, which is added without NOT NULL, and given its type by hand
-- first, from the session's takeover and name, ignoring the name's case:
-- - with a collective, it's a takeover, and its name is dropped when it's empty or the one the type gives it;
-- - else, when its name is GUEST MIXES, LIVE PERFORMANCE or SYNTH MEETUPS, it's of that type, and its name is dropped;
-- - else, with a name, it's of type other, which keeps it, e.g. a takeover whose collective isn't known;
-- - else, it's guest mixes, which admins correct by hand afterwards.
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_takeover_id_collectives_id_fk";
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "type" text;--> statement-breakpoint
UPDATE "sessions" SET "type" = 'takeover', "name" = CASE WHEN lower("sessions"."name") = lower("collectives"."name" || ' TAKEOVER') THEN '' ELSE "sessions"."name" END
	FROM "collectives" WHERE "collectives"."id" = "sessions"."takeover_id";--> statement-breakpoint
UPDATE "sessions" SET "type" = CASE lower("name") WHEN 'guest mixes' THEN 'guest-mixes' WHEN 'live performance' THEN 'live-performance' ELSE 'synth-meetup' END, "name" = ''
	WHERE "type" IS NULL AND lower("name") IN ('guest mixes', 'live performance', 'synth meetups');--> statement-breakpoint
UPDATE "sessions" SET "type" = 'other' WHERE "type" IS NULL AND "name" <> '';--> statement-breakpoint
UPDATE "sessions" SET "type" = 'guest-mixes' WHERE "type" IS NULL;--> statement-breakpoint
ALTER TABLE "sessions" ALTER COLUMN "type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_takeover_id_collectives_id_fk" FOREIGN KEY ("takeover_id") REFERENCES "public"."collectives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_type" CHECK ("sessions"."type" in ('guest-mixes', 'live-performance', 'takeover', 'synth-meetup', 'other'));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_takeover" CHECK (("sessions"."type" = 'takeover') = ("sessions"."takeover_id" is not null));--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_named" CHECK ("sessions"."type" <> 'other' or "sessions"."name" <> '');
