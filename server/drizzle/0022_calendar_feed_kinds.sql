-- Gives every calendar feed a kind (see "Feeds" in docs/design/server/calendar.md): every existing feed becomes
-- "occupations", which is what it was read as until then. The API has no default, so the column keeps none once it's
-- filled in. Older servers can still list and change feeds once it's applied, but can't add one: without a kind, the
-- insert fails, with a 500. Nothing is removed, so no snapshot is needed before deploying it.
--
-- The schema changes are drizzle-kit's, but for the column's default, which is added, then dropped, by hand.
ALTER TABLE "calendar_feeds" ADD COLUMN "kind" text DEFAULT 'occupations' NOT NULL;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ALTER COLUMN "kind" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "calendar_feeds" ADD CONSTRAINT "calendar_feeds_kind" CHECK ("calendar_feeds"."kind" in ('occupations', 'holds'));
