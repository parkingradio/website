ALTER TABLE "users" ADD COLUMN "ics_subscription_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_ics_subscription_token_unique" UNIQUE("ics_subscription_token");