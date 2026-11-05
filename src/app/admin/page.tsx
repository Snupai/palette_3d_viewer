"use client";

import { AdminUsersScreen } from "~/features/admin/AdminUsersScreen";

/** `/admin` — user management for admins (#32). */
export default function AdminPage() {
  return (
    <main className="fable-app">
      <AdminUsersScreen />
    </main>
  );
}
