CREATE TABLE "oauth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"code_challenge" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"connection_id" uuid,
	CONSTRAINT "oauth_codes_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_id" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"access_token_hash" text NOT NULL,
	"access_token_expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "oauth_connections_access_token_hash_unique" UNIQUE("access_token_hash")
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"connection_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "oauth_refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_codes" ADD CONSTRAINT "oauth_codes_connection_id_oauth_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."oauth_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_connection_id_oauth_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."oauth_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_codes_user_id_idx" ON "oauth_codes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_codes_connection_id_idx" ON "oauth_codes" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "oauth_connections_user_id_idx" ON "oauth_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_tokens_connection_id_idx" ON "oauth_refresh_tokens" USING btree ("connection_id");