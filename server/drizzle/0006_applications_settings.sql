CREATE TABLE "applications_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"recipients" text[] NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "applications_settings_single_row" CHECK ("applications_settings"."id" = 1)
);
