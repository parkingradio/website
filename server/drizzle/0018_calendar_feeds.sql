CREATE TABLE "calendar_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"link" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feeds_kind" CHECK ("calendar_feeds"."kind" in ('occupation', 'quiet-time'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feeds_link_idx" ON "calendar_feeds" USING btree ("link");