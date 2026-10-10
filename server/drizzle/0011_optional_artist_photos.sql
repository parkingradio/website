ALTER TABLE "artists" ALTER COLUMN "photo_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "artists" ALTER COLUMN "photo_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "artists" ADD CONSTRAINT "artists_photo" CHECK (("artists"."photo_key" is null) = ("artists"."photo_type" is null));