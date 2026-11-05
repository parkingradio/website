-- Lets a session's sets overlap each other: they're meant not to, but the server no longer refuses it, so that times can
-- be changed in any order (see "Sets' places" in docs/design/server/sessions.md). Older servers still work once it's
-- applied: they only stop getting the constraint's error.
--
-- Written by hand, since drizzle can't declare exclusion constraints. The btree_gist extension, which only this
-- constraint used, stays: removing it gains nothing, and could fail where the server's user doesn't own it.
ALTER TABLE "sets" DROP CONSTRAINT "sets_no_overlap";
