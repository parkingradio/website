-- Migrates the artists whose `kind` is "collective", as collectives were before they had their own profiles, to
-- collectives, then removes `kind` and `members` from artists (see docs/deployment.md, "Database migrations").
--
-- Each one becomes a collective with the same id, name, country, city, links and photo, its bio as the description, its
-- email and phone as the contact's, and who added and last changed it, and when. Its photo keeps its key, since photos
-- are read and deleted by key, whatever folder they're in. Each name in its `members` becomes a new artist, in order,
-- with only that name and the legacy collective's genres, as when a collective applies (see "POST /api/applications"
-- in docs/design/server/applications.md), added when and by whom the legacy collective was. Its applications become the
-- collective's.
--
-- Since collectives were added, an admin may have added a legacy collective again, with the same email. The migration
-- then fails, changing nothing: give one of them another email, then start the server again. It fails the same way for
-- a legacy collective that's a member of a collective, which the server refuses, rather than drop the membership. The
-- errors name the legacy collectives by name and id rather than by email, since they're logged.
DO $$
DECLARE
  found text;
BEGIN
  SELECT string_agg(format('%s (%s)', "artists"."name", "artists"."id"), ', ' ORDER BY "artists"."name") INTO found
  FROM "artists" JOIN "collectives" ON lower("collectives"."email") = lower("artists"."email")
  WHERE "artists"."kind" = 'collective';
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'These artists whose kind is "collective" have the email of a collective, so they can''t become collectives: %. Give them, or the collectives, other emails, then start the server again.', found;
  END IF;
  SELECT string_agg(format('%s (%s)', "artists"."name", "artists"."id"), ', ' ORDER BY "artists"."name") INTO found
  FROM "artists"
  WHERE "artists"."kind" = 'collective' AND EXISTS (SELECT FROM "collective_members" WHERE "artist_id" = "artists"."id");
  IF found IS NOT NULL THEN
    RAISE EXCEPTION 'These artists whose kind is "collective" are members of collectives, so they can''t become collectives: %. Take them out of those collectives, then start the server again.', found;
  END IF;
END $$;
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
