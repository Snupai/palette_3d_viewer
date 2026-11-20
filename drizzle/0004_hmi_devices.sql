CREATE TABLE "hmi_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"active_final_id" uuid,
	"app_version" text,
	CONSTRAINT "hmi_devices_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "hmi_devices_token_hash_hex" CHECK ("hmi_devices"."token_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "hmi_devices" ADD CONSTRAINT "hmi_devices_active_final_id_plan_finals_id_fk" FOREIGN KEY ("active_final_id") REFERENCES "public"."plan_finals"("id") ON DELETE set null ON UPDATE no action;