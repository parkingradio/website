CREATE TABLE "collective_members" (
	"collective_id" uuid NOT NULL,
	"artist_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "collective_members_collective_id_artist_id_pk" PRIMARY KEY("collective_id","artist_id")
);
--> statement-breakpoint
CREATE TABLE "collectives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" text,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"city" text NOT NULL,
	"description" text NOT NULL,
	"links" jsonb NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"photo_key" text,
	"photo_type" text,
	"updated_by" text,
	"updated_at" timestamp with time zone,
	CONSTRAINT "collectives_photo" CHECK (("collectives"."photo_key" is null) = ("collectives"."photo_type" is null))
);
--> statement-breakpoint
ALTER TABLE "collective_members" ADD CONSTRAINT "collective_members_collective_id_collectives_id_fk" FOREIGN KEY ("collective_id") REFERENCES "public"."collectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collective_members" ADD CONSTRAINT "collective_members_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collective_members_artist_id_idx" ON "collective_members" USING btree ("artist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collectives_email_lower_idx" ON "collectives" USING btree (lower("email"));