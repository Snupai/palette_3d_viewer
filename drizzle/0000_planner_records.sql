CREATE TABLE "planner_records" (
	"store" text NOT NULL,
	"id" text NOT NULL,
	"json" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planner_records_store_id_pk" PRIMARY KEY("store","id"),
	CONSTRAINT "planner_records_json_object" CHECK (jsonb_typeof("planner_records"."json") = 'object'),
	CONSTRAINT "planner_records_version_positive" CHECK ("planner_records"."version" >= 1)
);
