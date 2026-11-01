-- Adds collectives, whose members are artists, lets an application belong to a collective rather than an artist, and
-- lets an artist be without an email. Then migrates the artists whose `kind` is "collective", as collectives were
-- before they had their own profiles, to collectives, and removes `kind` and `members` from artists (see
-- docs/deployment.md, "Database migrations").
--
-- Each one becomes a collective with the same id, name, country, city, links and photo, its bio as the description, its
-- email and phone as the contact's, and who added and last changed it, and when. Its photo keeps its key, since photos
-- are read and deleted by key, whatever folder they're in. Each name in its `members` becomes a new artist, in order,
-- with only that name and the legacy collective's genres, added when and by whom the legacy collective was. Its
-- applications become the collective's.
--
-- The schema changes are drizzle-kit's, except that dropping `kind` and `members` comes last, since the data steps,
-- written by hand, need them.
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
ALTER TABLE "applications" ALTER COLUMN "artist_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "artists" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "collective_id" uuid;--> statement-breakpoint
ALTER TABLE "collective_members" ADD CONSTRAINT "collective_members_collective_id_collectives_id_fk" FOREIGN KEY ("collective_id") REFERENCES "public"."collectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collective_members" ADD CONSTRAINT "collective_members_artist_id_artists_id_fk" FOREIGN KEY ("artist_id") REFERENCES "public"."artists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collective_members_artist_id_idx" ON "collective_members" USING btree ("artist_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collectives_email_lower_idx" ON "collectives" USING btree (lower("email"));--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_collective_id_collectives_id_fk" FOREIGN KEY ("collective_id") REFERENCES "public"."collectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_collective_id_idx" ON "applications" USING btree ("collective_id");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_owner" CHECK (("applications"."artist_id" is null) <> ("applications"."collective_id" is null));
--> statement-breakpoint
INSERT INTO "collectives" ("id", "created_at", "created_by", "name", "country", "city", "description", "links", "email", "phone", "photo_key", "photo_type", "updated_by", "updated_at")
SELECT "id", "created_at", "created_by", "name", "country", "city", "bio", "links", "email", "phone", "photo_key", "photo_type", "updated_by", "updated_at"
FROM "artists" WHERE "kind" = 'collective';
--> statement-breakpoint
-- The artists to create, one for each name in the members of a legacy collective, with their position among them.
CREATE TEMPORARY TABLE "legacy_members" AS
SELECT gen_random_uuid() AS "artist_id", "artists"."id" AS "collective_id", ("member"."ordinality" - 1)::integer AS "position",
  "member"."name", "artists"."genres", "artists"."created_at", "artists"."created_by"
FROM "artists", unnest("artists"."members") WITH ORDINALITY AS "member"("name", "ordinality")
WHERE "artists"."kind" = 'collective';
--> statement-breakpoint
INSERT INTO "artists" ("id", "created_at", "created_by", "email", "kind", "name", "members", "country", "city", "genres", "bio", "links", "phone")
SELECT "artist_id", "created_at", "created_by", NULL, 'artist', "name", '{}', '', '', "genres", '', '{}', '' FROM "legacy_members";
--> statement-breakpoint
INSERT INTO "collective_members" ("collective_id", "artist_id", "position")
SELECT "collective_id", "artist_id", "position" FROM "legacy_members";
--> statement-breakpoint
DROP TABLE "legacy_members";
--> statement-breakpoint
UPDATE "applications" SET "collective_id" = "artist_id", "artist_id" = NULL
WHERE "artist_id" IN (SELECT "id" FROM "artists" WHERE "kind" = 'collective');
--> statement-breakpoint
DELETE FROM "artists" WHERE "kind" = 'collective';
--> statement-breakpoint
ALTER TABLE "artists" DROP CONSTRAINT "artists_kind";--> statement-breakpoint
ALTER TABLE "artists" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "artists" DROP COLUMN "members";
