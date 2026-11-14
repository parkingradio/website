-- Lets sets and sessions have the application they come from (see "Applications" in docs/design/server/sessions.md):
-- none at first, so there's nothing to backfill. Older servers still work once it's applied: they never give a set or a
-- session an application, and deleting an application takes it from its sets and sessions, but without the sessions'
-- lock (see sessions/store.ts). But they don't check the rules of what a set's or a session's application can be either,
-- so once links exist, going back to an older server lets its changes break them, e.g. taking the application's artist
-- out of a set's performers: changing such a set or session on a newer server then takes sending its `application` too.
ALTER TABLE "sessions" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "application_id" uuid;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_application_id_idx" ON "sessions" USING btree ("application_id");--> statement-breakpoint
CREATE INDEX "sets_application_id_idx" ON "sets" USING btree ("application_id");