-- Lets sets and sessions have the application they come from (see "Applications" in docs/design/server/sessions.md):
-- none at first, so there's nothing to backfill. Older servers still work once it's applied: they never give a set or a
-- session an application, and deleting an application takes it from its sets and sessions, but without the sessions'
-- lock (see sessions/store.ts).
ALTER TABLE "sessions" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_application_id_idx" ON "sessions" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "sets_application_id_idx" ON "sets" USING btree ("application_id");