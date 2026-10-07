CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text NOT NULL,
	"artist_id" uuid NOT NULL,
	"dates" date[] NOT NULL,
	"time_slots" jsonb NOT NULL,
	"prestations" text[] NOT NULL,
	"details" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone,
	"status" text DEFAULT 'new' NOT NULL,
	"status_updated_by" text,
	"status_updated_at" timestamp with time zone,
	CONSTRAINT "applications_status" CHECK ("applications"."status" in ('new', 'accepted', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_artist_id_idx" ON "applications" USING btree ("artist_id");