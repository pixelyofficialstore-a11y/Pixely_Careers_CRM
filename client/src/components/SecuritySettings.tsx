import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck, ShieldOff, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getErrorMessage } from "@/lib/queryClient";
import { api } from "@shared/routes";
import { ChangePasswordForm } from "@/components/ChangePasswordScreen";

type AuditRow = {
  id: number;
  createdAt: string;
  action: string;
  actorId: number | null;
  actorRole: string | null;
  actorName: string | null;
  targetType: string | null;
  targetId: string | null;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  details: Record<string, unknown> | null;
};

const ACTION_LABELS: Record<string, string> = {
  login_success: "Signed in",
  login_failed: "Failed sign-in",
  login_locked: "Sign-in locked",
  logout: "Signed out",
  password_changed: "Changed password",
  password_reset_by_admin: "Password reset by admin",
  totp_enabled: "2-step verification on",
  totp_disabled: "2-step verification off",
  user_created: "User created",
  user_updated: "User edited",
  user_role_changed: "Role changed",
  user_deactivated: "User deactivated",
  user_reactivated: "User reactivated",
  order_deleted: "Order deleted",
  order_canceled: "Order canceled",
  payment_approved: "Payment approved",
  payment_disapproved: "Payment disapproved",
  export: "Export",
  settings_changed: "Settings changed",
};

function describe(row: AuditRow): string {
  const d = row.details || {};
  switch (row.action) {
    case "login_failed":
    case "login_locked":
      return `Username "${row.targetId ?? ""}"${d.reason ? ` · ${String(d.reason).toLowerCase().replace(/_/g, " ")}` : ""}`;
    case "user_role_changed":
      return `User #${row.targetId}: ${d.from} → ${d.to}`;
    case "order_deleted":
    case "order_canceled":
      return `Order ${d.orderNumber ?? `#${row.targetId}`}${d.reason ? ` · ${d.reason}` : ""}`;
    case "payment_approved":
    case "payment_disapproved":
      return `Payment #${row.targetId} · order #${d.orderId}`;
    case "export":
      return `${row.targetId} (${d.format})`;
    case "settings_changed":
      return `${row.targetType}${row.targetId ? ` #${row.targetId}` : ""} · ${d.method}`;
    default:
      return row.targetType === "user" && row.targetId ? `User #${row.targetId}` : "";
  }
}

function SecurityLog() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState("");
  const pageSize = 50;
  const query = useQuery<{ rows: AuditRow[]; total: number }>({
    queryKey: ["/api/audit-events", page, action],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (action) params.set("action", action);
      const res = await fetch(`/api/audit-events?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
      return res.json();
    },
  });
  const totalPages = Math.max(1, Math.ceil((query.data?.total || 0) / pageSize));

  return (
    <section className="glass-panel rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Security log</h2>
          <p className="text-sm text-muted-foreground">Sign-ins, user changes, deletions, payment decisions, exports and settings changes.</p>
        </div>
        <select
          value={action}
          onChange={e => { setAction(e.target.value); setPage(1); }}
          className="crm-control h-10 px-3 text-sm"
          aria-label="Filter by action"
        >
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : query.isError ? (
        <p className="text-sm text-red-400">{getErrorMessage(query.error, "Couldn't load the security log.")}</p>
      ) : (query.data?.rows.length || 0) === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">No events yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">When</th>
                <th className="py-2 pr-3 font-medium">Event</th>
                <th className="py-2 pr-3 font-medium">By</th>
                <th className="py-2 pr-3 font-medium">Details</th>
                <th className="py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {query.data!.rows.map(row => (
                <tr key={row.id} className="border-t border-border/60 align-top">
                  <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                    {new Date(row.createdAt).toLocaleString("en-PK", { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2">
                      {ACTION_LABELS[row.action] || row.action}
                      {!row.success && <Badge variant="destructive" className="text-[10px]">failed</Badge>}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{row.actorName || (row.actorId ? `#${row.actorId}` : "—")}</td>
                  <td className="py-2 pr-3 text-muted-foreground">{describe(row)}</td>
                  <td className="py-2 font-mono text-xs text-muted-foreground">{row.ip || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <span className="text-xs text-muted-foreground">Page {page} of {totalPages}</span>
        <Button variant="outline" size="icon" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
      </div>
    </section>
  );
}

function TwoFactor() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast({ title: "Error", description: getErrorMessage(e), variant: "destructive" }); } finally { setBusy(false); }
  };

  const start = () => run(async () => {
    const res = await apiRequest("POST", "/api/user/2fa/setup");
    setSetup(await res.json());
  });
  const enable = () => run(async () => {
    const res = await apiRequest("POST", "/api/user/2fa/enable", { code });
    queryClient.setQueryData([api.auth.me.path], await res.json());
    setSetup(null); setCode("");
    toast({ title: "2-step verification is on" });
  });
  const disable = () => run(async () => {
    const res = await apiRequest("POST", "/api/user/2fa/disable", { password });
    queryClient.setQueryData([api.auth.me.path], await res.json());
    setPassword("");
    toast({ title: "2-step verification is off" });
  });

  return (
    <section className="glass-panel rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-3">
        {user?.totpEnabled ? <ShieldCheck className="h-5 w-5 text-emerald-500" /> : <ShieldOff className="h-5 w-5 text-muted-foreground" />}
        <div>
          <h2 className="text-base font-semibold">2-step verification</h2>
          <p className="text-sm text-muted-foreground">
            {user?.totpEnabled ? "On. Sign-in asks for a code from your authenticator app." : "Optional. Adds a code from an authenticator app (Google Authenticator, Authy, 1Password) at sign-in."}
          </p>
        </div>
      </div>

      {user?.totpEnabled ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <label htmlFor="tf-pass" className="text-xs font-semibold text-muted-foreground">Your password</label>
            <input id="tf-pass" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="crm-control h-11 w-64 px-3 text-sm" />
          </div>
          <Button variant="outline" className="h-11" disabled={busy || !password} onClick={disable}>Turn off</Button>
        </div>
      ) : setup ? (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>In your authenticator app choose "Enter a setup key".</li>
            <li>Account: <span className="font-medium text-foreground">Pixely Workspace</span>, key type: time-based.</li>
            <li>Enter the key below, then type the 6-digit code it shows.</li>
          </ol>
          <code className="block select-all break-all rounded-md border border-border bg-muted/40 px-3 py-2.5 font-mono text-sm tracking-wider">
            {setup.secret.replace(/(.{4})/g, "$1 ").trim()}
          </code>
          <a href={setup.otpauthUri} className="text-xs text-primary underline">Open in authenticator app (phone)</a>
          <div className="flex flex-wrap items-end gap-2">
            <input value={code} onChange={e => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="123456" className="crm-control h-11 w-40 px-3 text-sm tracking-[0.3em]" aria-label="6-digit code" />
            <Button className="h-11" disabled={busy || code.replace(/\s/g, "").length !== 6} onClick={enable}>Verify and turn on</Button>
            <Button variant="ghost" className="h-11" onClick={() => setSetup(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button className="h-11" disabled={busy} onClick={start}>Set up 2-step verification</Button>
      )}
    </section>
  );
}

export default function SecuritySettings() {
  const { toast } = useToast();
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="glass-panel rounded-xl p-5 space-y-4">
          <div>
            <h2 className="text-base font-semibold">Change my password</h2>
            <p className="text-sm text-muted-foreground">Signs you out on every other device.</p>
          </div>
          <ChangePasswordForm onDone={() => toast({ title: "Password changed" })} />
        </section>
        <TwoFactor />
      </div>
      <SecurityLog />
    </div>
  );
}
