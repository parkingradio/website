-- Renames the prestations of applications and sets, and their other prestation, to their performance types and their
-- other performance type, as the API names them, keeping what they hold. Older servers can't read applications or sets
-- anymore once it's applied (see docs/deployment.md, "Database migrations").
--
-- Written by hand: drizzle-kit only asks whether a column is renamed, interactively.
ALTER TABLE "applications" RENAME COLUMN "prestations" TO "performance_types";--> statement-breakpoint
ALTER TABLE "applications" RENAME COLUMN "other_prestation" TO "other_performance_type";--> statement-breakpoint
ALTER TABLE "sets" RENAME COLUMN "prestations" TO "performance_types";--> statement-breakpoint
ALTER TABLE "sets" RENAME COLUMN "other_prestation" TO "other_performance_type";
