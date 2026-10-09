-- The default only fills the rows that are already there: every application that's saved has its other prestation.
ALTER TABLE "applications" ADD COLUMN "other_prestation" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ALTER COLUMN "other_prestation" DROP DEFAULT;--> statement-breakpoint
-- Prestations used to be stored as they were written. Those that are one of PRESTATIONS (in shared/src/applications.ts),
-- whatever their case, become its id, in the order of that list. The others go together in "other_prestation" if they
-- fit in its 60 characters, and at the end of the details otherwise, so that nothing is lost. Characters are counted as
-- bytes, which is never fewer than the server counts, so that the other prestation is never too long for it.
WITH "known"("position", "id", "name") AS (
	VALUES (1, 'dj', 'dj'), (2, 'vinyl', 'vinyl'), (2, 'vinyl', 'vinyle'), (3, 'live-performance', 'performance live'),
		(4, 'rap', 'rap'), (5, 'full-band', 'full band')
), "converted" AS (
	SELECT
		"applications"."id",
		array(
			SELECT "known"."id" FROM "known"
			WHERE "known"."name" IN (SELECT lower("prestation") FROM unnest("applications"."prestations") AS sent("prestation"))
			GROUP BY "known"."position", "known"."id"
			ORDER BY "known"."position"
		) AS "prestations",
		(
			SELECT string_agg("prestation", ', ' ORDER BY "position")
			FROM unnest("applications"."prestations") WITH ORDINALITY AS sent("prestation", "position")
			WHERE lower("prestation") NOT IN (SELECT "name" FROM "known")
		) AS "others"
	FROM "applications"
)
UPDATE "applications" SET
	"prestations" = "converted"."prestations",
	"other_prestation" = CASE WHEN octet_length("converted"."others") <= 60 THEN "converted"."others" ELSE '' END,
	"details" = CASE
		WHEN octet_length("converted"."others") > 60
		THEN concat_ws(E'\n\n', nullif("applications"."details", ''), 'Autres prestations : ' || "converted"."others")
		ELSE "applications"."details"
	END
FROM "converted"
WHERE "applications"."id" = "converted"."id";
