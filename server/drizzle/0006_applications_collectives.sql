ALTER TABLE "applications" ALTER COLUMN "artist_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "collective_id" uuid;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_collective_id_collectives_id_fk" FOREIGN KEY ("collective_id") REFERENCES "public"."collectives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "applications_collective_id_idx" ON "applications" USING btree ("collective_id");--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_owner" CHECK (("applications"."artist_id" is null) <> ("applications"."collective_id" is null));