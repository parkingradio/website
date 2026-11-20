-- Checks that every photo's and flyer's key is made from its content, in the folder of its kind (see "Private files" in
-- docs/deployment.md): `<folder>/<sha256>.<extension>`, with `artists/` for artists, `collectives/` for collectives and
-- `sessions/` for sessions. Since #201 (step 1 of #200), the server only stores images under such keys, and moved those
-- it kept under random keys, `<folder>/<uuid>.<extension>`, except those it found missing from the bucket, which keep
-- their key until an admin removes or replaces them.
--
-- It fails, and with it the server's start, while a row has another key. So before deploying it, in every deployment,
-- this must give no row, run against its database, e.g. from the app's container, through SSM, as #203 shows, and when
-- it fails, it gives the rows it fails on:
--
--   select 'artist' as of, id, photo_key as key from artists where photo_key !~ '^artists/[0-9a-f]{64}[.](jpg|png|webp)$'
--   union all select 'collective', id, photo_key from collectives where photo_key !~ '^collectives/[0-9a-f]{64}[.](jpg|png|webp)$'
--   union all select 'session', id, flyer_key from sessions where flyer_key !~ '^sessions/[0-9a-f]{64}[.](jpg|png|webp)$'
--
-- Such a row's image is either not moved yet, which a server from #201 or #202 does when it starts, or missing, which it
-- logs (`A photo or flyer to move to a key made from its content is missing`): remove or replace it on the admin pages.
-- Deployed before then, nothing is applied, but the server keeps restarting and failing, and the site is down until the
-- previous image is deployed again. A local database runs the previous version once, or is seeded again from empty.
--
-- Servers from #201 on still work once it's applied. Older ones can't store photos anymore, and delete an image as soon
-- as one row stops having it, even when others still have it, which then has to be restored from the bucket's previous
-- versions.
ALTER TABLE "artists" ADD CONSTRAINT "artists_photo_key" CHECK ("artists"."photo_key" ~ '^artists/[0-9a-f]{64}[.](jpg|png|webp)$');--> statement-breakpoint
ALTER TABLE "collectives" ADD CONSTRAINT "collectives_photo_key" CHECK ("collectives"."photo_key" ~ '^collectives/[0-9a-f]{64}[.](jpg|png|webp)$');--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_flyer_key" CHECK ("sessions"."flyer_key" ~ '^sessions/[0-9a-f]{64}[.](jpg|png|webp)$');