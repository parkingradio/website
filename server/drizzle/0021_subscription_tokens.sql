ALTER TABLE "users" ADD COLUMN "subscription_token" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_subscription_token_unique" UNIQUE("subscription_token");