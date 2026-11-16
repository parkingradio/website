-- Lets sessions be announced, once they have a start (see "Announced" in docs/design/server/sessions.md). Existing
-- sessions start unannounced, so there's nothing to backfill. Older servers still work once it's applied, except that
-- removing the start of a session that's announced fails unexpectedly on them, with the constraint's error.
ALTER TABLE "sessions" ADD COLUMN "announced" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "announced_updated_by" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "announced_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_announced" CHECK (not "sessions"."announced" or "sessions"."start_at" is not null);