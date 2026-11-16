-- Lets sessions and sets last more than 24 hours, e.g. a weekend (see "Times" in docs/design/server/sessions.md): the
-- server keeps durations to the time from the start of 2000 to the start of 3000, and the database only to at least a
-- minute, like the start, whose range it doesn't check either. Existing rows already follow it. Older servers still work
-- once it's applied, though they refuse to save a session or a set that lasts more than 24 hours as it is.
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_duration";--> statement-breakpoint
ALTER TABLE "sets" DROP CONSTRAINT "sets_duration";--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_duration" CHECK ("sessions"."duration_minutes" >= 1);--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_duration" CHECK ("sets"."duration_minutes" >= 1);