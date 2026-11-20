CREATE TABLE "hmi_proposals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"hmi_id" uuid NOT NULL,
	"final_id" uuid NOT NULL,
	"proposed_by" text,
	"created_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "hmi_proposals_state_known" CHECK ("hmi_proposals"."state" IN ('pending', 'accepted', 'rejected', 'superseded', 'expired', 'cancelled')),
	CONSTRAINT "hmi_proposals_resolved_when_closed" CHECK (("hmi_proposals"."state" = 'pending') = ("hmi_proposals"."resolved_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "hmi_proposals" ADD CONSTRAINT "hmi_proposals_hmi_id_hmi_devices_id_fk" FOREIGN KEY ("hmi_id") REFERENCES "public"."hmi_devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hmi_proposals" ADD CONSTRAINT "hmi_proposals_final_id_plan_finals_id_fk" FOREIGN KEY ("final_id") REFERENCES "public"."plan_finals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hmi_proposals" ADD CONSTRAINT "hmi_proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "hmi_proposals_one_pending_per_hmi" ON "hmi_proposals" USING btree ("hmi_id") WHERE "hmi_proposals"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "hmi_proposals_hmi_created_idx" ON "hmi_proposals" USING btree ("hmi_id","created_at");