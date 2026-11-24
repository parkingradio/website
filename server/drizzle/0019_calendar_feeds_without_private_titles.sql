-- Calendar feeds no longer have private titles (#228): every feed's titles are kept and given. The only feed in
-- production had them shown, so nothing changes for it. Older servers can't read the feeds once it's applied, since
-- they read the column, so a problem found afterwards is fixed forward (see "Database migrations" in
-- docs/deployment.md). No snapshot is needed before deploying it: the column only ever held `false` in production, so
-- dropping it loses nothing.
ALTER TABLE "calendar_feeds" DROP COLUMN "private_titles";
