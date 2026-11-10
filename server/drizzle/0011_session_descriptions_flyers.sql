-- Gives sessions a description, "" for none, and maybe a flyer (see "Descriptions" and "Flyers" in
-- docs/design/server/sessions.md). There's nothing to backfill, and older servers still work once it's applied.
ALTER TABLE "sessions" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "flyer_key" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "flyer_type" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_flyer" CHECK (("sessions"."flyer_key" is null) = ("sessions"."flyer_type" is null));