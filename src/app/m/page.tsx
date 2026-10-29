import { redirect } from "next/navigation";

/** Older mobile bookmarks now use the same complete responsive planner. */
export default function MobilePlanPage() {
  redirect("/");
}
