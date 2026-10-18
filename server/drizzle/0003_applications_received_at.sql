ALTER TABLE "applications" ADD COLUMN "received_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- The applications that already exist were received when they were created, as far as we know.
UPDATE "applications" SET "received_at" = "created_at";
