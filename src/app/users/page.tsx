"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { Button, Card, ErrorMessage, Field, inputClass } from "@/components/ui/form";
import { useQuery } from "@/lib/hooks";
import { useCurrentProfile, usePermissions } from "@/lib/profile-context";
import { formatDate } from "@/lib/format";
import { isMock, supabase } from "@/lib/supabase";
import type { RoleRow } from "@/lib/types";

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  role: string | null;
  active: boolean;
  driver: string | null;
  last_sign_in_at: string | null;
};
type UsersResponse = { users: UserRow[]; unlinkedDrivers: { id: string; name: string }[] };

// Calls our server routes with the signed-in user's token; the server checks they hold users.manage.
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? res.statusText);
  return json as T;
}

export default function UsersPage() {
  const me = useCurrentProfile();
  const { can } = usePermissions();
  const isSuperAdmin = me.role === "super_admin";

  // Roles come from the database, so a new role (like Manager) appears here automatically.
  const rolesQuery = useQuery<RoleRow[]>(() => supabase.from("roles").select("*").order("sort"));
  const allRoles = rolesQuery.data ?? [];
  // Only a super admin can hand out the super admin role.
  const assignable = allRoles.filter((r) => isSuperAdmin || r.key !== "super_admin");
  const roleLabel = (key: string | null) => allRoles.find((r) => r.key === key)?.label ?? key ?? "No access";

  const users = useQuery<UsersResponse>(() =>
    isMock
      ? Promise.resolve({ data: null, error: null })
      : api<UsersResponse>("/api/users").then(
          (data) => ({ data, error: null }),
          (e: Error) => ({ data: null, error: { message: e.message } })
        )
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [role, setRole] = useState("staff");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, success: string) {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(success);
      users.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function addUser(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    await run(
      () =>
        api("/api/users", {
          method: "POST",
          body: JSON.stringify({
            full_name: f.get("full_name"),
            email: f.get("email"),
            password: f.get("password"),
            role,
            driver_id: f.get("driver_id") || null,
          }),
        }),
      `Added ${f.get("full_name")}. Share the email and temporary password with them.`
    );
    setBusy(false);
    form.reset();
    setRole("staff");
  }

  const patch = (id: string, body: object, success: string) =>
    run(() => api(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }), success);

  return (
    <>
      <PageHeader title="Users" description="Add people and choose their role. What each role can do is set under Roles & Permissions." />

      {isMock && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          User management needs the real Supabase connection. It is not available in mock data mode.
        </p>
      )}

      <Card title="Roles" className="mb-6">
        <dl className="space-y-2 text-sm">
          {allRoles.map((r) => (
            <div key={r.key} className="grid gap-1 sm:grid-cols-[11rem_1fr]">
              <dt className="font-medium">{r.label}</dt>
              <dd className="text-slate-600">{r.description}</dd>
            </div>
          ))}
        </dl>
        {can("roles.manage") && (
          <Link href="/roles" className="mt-3 inline-block text-sm font-medium text-blue-700">
            Edit what each role can do →
          </Link>
        )}
      </Card>

      {!isMock && (
        <Card title="Add a user" className="mb-6">
          <form onSubmit={addUser} className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <Field label="Full name">
              <input name="full_name" required className={inputClass} />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required className={inputClass} />
            </Field>
            <Field label="Temporary password (min 8 characters)">
              <input name="password" type="text" required minLength={8} autoComplete="off" className={inputClass} />
            </Field>
            <Field label="Role">
              <select value={role} onChange={(e) => setRole(e.target.value)} className={inputClass}>
                {assignable.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            {role === "driver" && (
              <Field label="Driver record">
                <select name="driver_id" defaultValue="" className={inputClass}>
                  <option value="">Create a new driver record</option>
                  {users.data?.unlinkedDrivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      Link to existing: {d.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                {busy ? "Adding…" : "Add user"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <ErrorMessage message={error ?? users.error} />
      {notice && <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p>}

      {users.data && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">Person</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last sign-in</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {users.data.users.map((u) => {
                const isMe = u.id === me.id;
                // Managers cannot modify a super admin.
                const locked = isMe || (!isSuperAdmin && u.role === "super_admin");
                return (
                  <tr key={u.id}>
                    <td className="px-4 py-3">
                      <p className="font-medium">
                        {u.full_name || "—"} {isMe && <span className="text-xs text-slate-500">(you)</span>}
                      </p>
                      <p className="text-slate-500">{u.email}</p>
                      {u.driver && <p className="text-xs text-slate-500">Driver: {u.driver}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        aria-label={`Role for ${u.email}`}
                        className={`${inputClass} w-auto`}
                        value={u.role ?? ""}
                        disabled={locked}
                        onChange={(e) => patch(u.id, { role: e.target.value }, `Role updated for ${u.email}`)}
                      >
                        {!u.role && <option value="">No access</option>}
                        {u.role && !assignable.some((r) => r.key === u.role) && (
                          <option value={u.role}>{roleLabel(u.role)}</option>
                        )}
                        {assignable.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          u.role && u.active ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {!u.role ? "No access" : u.active ? "Active" : "Deactivated"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {u.last_sign_in_at ? formatDate(u.last_sign_in_at) : "Never"}
                    </td>
                    <td className="space-x-3 whitespace-nowrap px-4 py-3 text-right">
                      {(!locked || isMe) && (
                        <button
                          className="text-blue-700"
                          onClick={() => {
                            const pw = prompt(`New password for ${u.email} (min 8 characters):`);
                            if (pw) patch(u.id, { password: pw }, `Password changed for ${u.email}`);
                          }}
                        >
                          Reset password
                        </button>
                      )}
                      {!locked && (
                        <button
                          className={u.active && u.role ? "text-red-600" : "text-blue-700"}
                          onClick={() =>
                            patch(
                              u.id,
                              { active: !(u.active && u.role) },
                              u.active && u.role ? `${u.email} deactivated` : `${u.email} activated`
                            )
                          }
                        >
                          {u.active && u.role ? "Deactivate" : "Activate"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
