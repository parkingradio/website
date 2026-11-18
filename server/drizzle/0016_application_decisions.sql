-- Applications only keep what admins decided, "new", "accepted" or "rejected", as their decision, and their status is
-- worked out from it and from their sets and sessions (see "Status" in docs/design/server/applications.md): "scheduled"
-- and "done" become "accepted", which their sets or sessions then make planned or done, once they're linked to them. The
-- status's columns become the decision's. A rejected application has no set or session that's planned or done, which
-- this checks first, failing rather than leaving data that breaks it. Older servers can't read applications once it's
-- applied, since their columns are renamed, so a problem found afterwards is fixed forward: take a manual snapshot before
-- deploying it (see "Database migrations" in docs/deployment.md).
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
ALTER TABLE "applications" RENAME COLUMN "status" TO "decision";--> statement-breakpoint
ALTER TABLE "applications" RENAME COLUMN "status_updated_by" TO "decision_updated_by";--> statement-breakpoint
ALTER TABLE "applications" RENAME COLUMN "status_updated_at" TO "decision_updated_at";--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_decision" CHECK ("applications"."decision" in ('new', 'accepted', 'rejected'));
