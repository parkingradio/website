CREATE TABLE "artists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"email" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"members" text[] NOT NULL,
	"country" text NOT NULL,
	"city" text NOT NULL,
	"genres" text[] NOT NULL,
	"bio" text NOT NULL,
	"links" jsonb NOT NULL,
	"phone" text NOT NULL,
	"photo_key" text NOT NULL,
	"photo_type" text NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone,
	CONSTRAINT "artists_kind" CHECK ("artists"."kind" in ('artist', 'collective'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "artists_email_lower_idx" ON "artists" USING btree (lower("email"));