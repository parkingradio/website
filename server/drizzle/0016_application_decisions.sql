-- Applications only keep what admins decided, "new", "accepted" or "rejected", and their status is worked out from it and
-- from their sets and sessions (see "Status" in docs/design/server/applications.md): "scheduled" and "done" become
-- "accepted", which their sets or sessions then make planned or done, once they're linked to them. A rejected application
-- has no set or session that's planned or done, which this checks first, failing rather than leaving data that breaks it.
-- Older servers still work once it's applied, but for giving an application a status other than these three, which
-- fails, and they don't keep that rule, so going back to one lets its changes break it.
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM "applications" WHERE "status" = 'rejected' AND (
      EXISTS (SELECT FROM "sets" WHERE "application_id" = "applications"."id" AND "status" <> 'cancelled')
      OR EXISTS (SELECT FROM "sessions" WHERE "application_id" = "applications"."id" AND "status" <> 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'A rejected application has a set or a session that''s planned or done';
  END IF;
END $$;--> statement-breakpoint
UPDATE "applications" SET "status" = 'accepted' WHERE "status" IN ('scheduled', 'done');--> statement-breakpoint
ALTER TABLE "applications" DROP CONSTRAINT "applications_status";--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_status" CHECK ("applications"."status" in ('new', 'accepted', 'rejected'));
