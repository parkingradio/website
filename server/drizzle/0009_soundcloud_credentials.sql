CREATE TABLE "soundcloud_credentials" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "soundcloud_credentials_single_row" CHECK ("soundcloud_credentials"."id" = 1)
);
