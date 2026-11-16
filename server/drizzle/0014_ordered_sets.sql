-- Puts each session's sets in an order, their positions, from 0, in place of their offsets after its start (see "Sets'
-- order" in docs/design/server/sessions.md). Each session's sets take the order the server gave them: by offset, those
-- without one last, then in the order they were added, then by id, so that it's always the same. Their durations stay,
-- and their offsets, so the breaks between them, are dropped. Older servers stop working once it's applied: every query
-- they make on sets needs the offsets.
--
-- The schema changes are drizzle-kit's, but for the column, which is added without NOT NULL, and given its position by
-- hand first, and the unique constraint, which drizzle can't declare, since it's deferrable: it's checked at the end of
-- each statement, rather than on each row, so that a single statement can shift several sets (see "sets" in
-- src/db/schema.ts). Its index also finds a session's sets, which sets_session_id_idx did.
ALTER TABLE "sets" ADD COLUMN "position" integer;--> statement-breakpoint
UPDATE "sets" SET "position" = "ordered"."position"
	FROM (SELECT "id", row_number() OVER (PARTITION BY "session_id" ORDER BY "offset_minutes" ASC NULLS LAST, "created_at", "id") - 1 AS "position" FROM "sets") AS "ordered"
	WHERE "ordered"."id" = "sets"."id";--> statement-breakpoint
ALTER TABLE "sets" ALTER COLUMN "position" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_position" CHECK ("sets"."position" >= 0);--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_session_id_position_key" UNIQUE ("session_id", "position") DEFERRABLE INITIALLY IMMEDIATE;--> statement-breakpoint
DROP INDEX "sets_session_id_idx";--> statement-breakpoint
ALTER TABLE "sets" DROP CONSTRAINT "sets_place";--> statement-breakpoint
ALTER TABLE "sets" DROP CONSTRAINT "sets_offset";--> statement-breakpoint
ALTER TABLE "sets" DROP COLUMN "offset_minutes";
