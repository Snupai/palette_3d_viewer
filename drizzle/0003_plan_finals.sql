CREATE TABLE "plan_finals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"record_store" text DEFAULT 'projects' NOT NULL,
	"record_id" text NOT NULL,
	"record_version" integer NOT NULL,
	"name" text NOT NULL,
	"file_name" text NOT NULL,
	"rob_text" text NOT NULL,
	"sha256" text NOT NULL,
	"marked_by" text,
	"marked_at" timestamp with time zone NOT NULL,
	"withdrawn_at" timestamp with time zone,
	CONSTRAINT "plan_finals_record_store_projects" CHECK ("plan_finals"."record_store" = 'projects'),
	CONSTRAINT "plan_finals_record_version_positive" CHECK ("plan_finals"."record_version" >= 1),
	CONSTRAINT "plan_finals_sha256_hex" CHECK ("plan_finals"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "plan_finals" ADD CONSTRAINT "plan_finals_marked_by_users_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_finals" ADD CONSTRAINT "plan_finals_record_fk" FOREIGN KEY ("record_store","record_id") REFERENCES "public"."planner_records"("store","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_finals_one_current_per_record" ON "plan_finals" USING btree ("record_store","record_id") WHERE "plan_finals"."withdrawn_at" IS NULL;--> statement-breakpoint
CREATE INDEX "plan_finals_record_idx" ON "plan_finals" USING btree ("record_store","record_id");