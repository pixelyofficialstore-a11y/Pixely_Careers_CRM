import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, KeyRound } from "lucide-react";
import { useAuth, type SessionUser } from "@/hooks/use-auth";

/**
 * Shown instead of the app when an admin reset this user's password (or the
 * account is new). Also usable from Settings as a normal "change password" form.
 */
export function ChangePasswordForm({ onDone, submitLabel = "Save new password" }: { onDone?: (user: SessionUser) => void; submitLabel?: string }) {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) return setError("The new passwords don't match.");
    if (newPassword.length < 10 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      return setError("Use at least 10 characters, with letters and at least one number.");
    }
    setSaving(true);
    try {
      const res = await fetch("/api/user/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return setError(body?.message || "Couldn't change the password.");
      queryClient.setQueryData(["/api/user"], body);
      setCurrentPassword(""); setNewPassword(""); setConfirm("");
      onDone?.(body as SessionUser);
    } catch {
      setError("Can't reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground" htmlFor="cp-current">Current (or temporary) password</label>
        <input id="cp-current" type="password" autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="crm-control h-11 w-full px-3 text-sm" required />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground" htmlFor="cp-new">New password</label>
        <input id="cp-new" type="password" autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="crm-control h-11 w-full px-3 text-sm" required />
        <p className="text-xs text-muted-foreground">At least 10 characters, with letters and a number.</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-muted-foreground" htmlFor="cp-confirm">Confirm new password</label>
        <input id="cp-confirm" type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className="crm-control h-11 w-full px-3 text-sm" required />
      </div>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
      <button type="submit" disabled={saving} className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary font-semibold text-primary-foreground disabled:opacity-50">
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        {submitLabel}
      </button>
    </form>
  );
}

export default function ChangePasswordScreen() {
  const { user, logoutMutation } = useAuth();
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4 py-8">
      <main className="w-full max-w-[400px]">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Set a new password</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {user?.name ? `${user.name}, your` : "Your"} password was set by an admin. Choose your own password to continue.
          </p>
        </div>
        <div className="glass-panel rounded-xl p-6">
          <ChangePasswordForm submitLabel="Save and continue" />
        </div>
        <button type="button" onClick={() => logoutMutation.mutate()} className="mx-auto mt-4 block min-h-[44px] text-sm text-muted-foreground hover:text-foreground">
          Sign out
        </button>
      </main>
    </div>
  );
}
