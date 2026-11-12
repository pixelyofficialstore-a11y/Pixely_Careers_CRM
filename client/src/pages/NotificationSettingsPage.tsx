import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRing, Moon, Send, Smartphone, Share } from "lucide-react";
import { PageHeader } from "@/components/CRMPrimitives";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getErrorMessage, queryClient } from "@/lib/queryClient";
import { disablePushOnThisDevice, enablePush, getPushState, type PushState } from "@/lib/push";
import { NOTIFICATION_CATEGORY_INFO, type NotificationCategory } from "@shared/notification-events";

type Prefs = {
  mutedEvents: NotificationCategory[];
  quietStart: number | null;
  quietEnd: number | null;
  categories: NotificationCategory[];
  devices: number;
  pushConfigured: boolean;
};

const KEY = ["/api/notification-preferences"];

const toTime = (m: number | null) => (m == null ? "" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
const fromTime = (v: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(v);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

export default function NotificationSettingsPage() {
  const { toast } = useToast();
  const [device, setDevice] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: prefs, isLoading } = useQuery<Prefs>({ queryKey: KEY });

  const refreshDevice = () => getPushState().then(setDevice).catch(() => {});
  useEffect(() => { refreshDevice(); }, []);

  const save = useMutation({
    mutationFn: async (next: Pick<Prefs, "mutedEvents" | "quietStart" | "quietEnd">) =>
      (await apiRequest("PUT", "/api/notification-preferences", next)).json(),
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const prev = queryClient.getQueryData<Prefs>(KEY);
      if (prev) queryClient.setQueryData<Prefs>(KEY, { ...prev, ...next });
      return { prev };
    },
    onError: (err, _next, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(KEY, ctx.prev);
      toast({ title: "Not saved", description: getErrorMessage(err), variant: "destructive" });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });

  const test = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/push/test")).json() as Promise<{ devices: number; delivered: number }>,
    onSuccess: (r) => toast({ title: "Test sent", description: `Delivered to ${r.delivered} of ${r.devices} device${r.devices === 1 ? "" : "s"}.` }),
    onError: (err) => toast({ title: "Test failed", description: getErrorMessage(err), variant: "destructive" }),
  });

  const turnOn = async () => {
    setBusy(true);
    const r = await enablePush();
    setBusy(false);
    await refreshDevice();
    queryClient.invalidateQueries({ queryKey: KEY });
    if (r.ok) toast({ title: "Notifications on", description: "This device will now get order alerts." });
    else toast({ title: "Not turned on", description: r.message, variant: "destructive" });
  };

  const turnOff = async () => {
    setBusy(true);
    await disablePushOnThisDevice().catch(() => {});
    setBusy(false);
    await refreshDevice();
    toast({ title: "Push off on this device", description: "You'll still see everything in the bell." });
  };

  if (isLoading || !prefs) {
    return <div className="crm-page"><PageHeader title="Notifications" /><p className="text-sm text-slate-500">Loading…</p></div>;
  }

  const muted = new Set(prefs.mutedEvents);
  const toggle = (c: NotificationCategory, on: boolean) => {
    const next = new Set(muted);
    if (on) next.delete(c); else next.add(c);
    save.mutate({ mutedEvents: Array.from(next), quietStart: prefs.quietStart, quietEnd: prefs.quietEnd });
  };
  const quietOn = prefs.quietStart != null && prefs.quietEnd != null;
  const setQuiet = (start: number | null, end: number | null) =>
    save.mutate({ mutedEvents: prefs.mutedEvents, quietStart: start, quietEnd: end });

  const deviceOn = Boolean(device?.subscribed && device.permission === "granted");

  return (
    <div className="crm-page space-y-5 max-w-3xl">
      <PageHeader title="Notifications" description="Choose what alerts you on your phone and computer. The bell always keeps everything." />

      {/* This device */}
      <section className="rounded-[.45rem] border border-border bg-[hsl(var(--card))] p-5">
        <div className="flex items-start gap-3">
          <Smartphone className="mt-0.5 h-5 w-5 text-cyan-300" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-slate-100">This device</h2>
            {!prefs.pushConfigured ? (
              <p className="mt-1 text-sm text-amber-300">Push is not configured on the server yet (VAPID keys). In-app alerts still work.</p>
            ) : device?.needsHomeScreen ? (
              <div className="mt-2 space-y-1 text-sm text-slate-300">
                <p>On iPhone, push works only from the Home Screen app (iOS 16.4 or newer):</p>
                <p className="flex items-center gap-1.5 text-slate-400">Tap <Share className="inline h-4 w-4" /> Share → <b className="text-slate-200">Add to Home Screen</b>, open Pixely from there, then come back here.</p>
              </div>
            ) : device && !device.supported ? (
              <p className="mt-1 text-sm text-slate-400">This browser does not support push notifications.</p>
            ) : device?.permission === "denied" ? (
              <p className="mt-1 text-sm text-amber-300">Notifications are blocked for this site. Allow them in the browser's site settings (padlock icon), then reload.</p>
            ) : (
              <p className="mt-1 text-sm text-slate-400">
                {deviceOn ? "Push is on for this device." : "Push is off for this device."}{" "}
                {prefs.devices > 0 && <span className="text-slate-500">({prefs.devices} device{prefs.devices === 1 ? "" : "s"} on your account)</span>}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {prefs.pushConfigured && device?.supported && !device.needsHomeScreen && device.permission !== "denied" && (
                deviceOn
                  ? <Button variant="outline" size="sm" onClick={turnOff} disabled={busy}>Turn off on this device</Button>
                  : <Button size="sm" onClick={turnOn} disabled={busy}><BellRing className="mr-1.5 h-4 w-4" />Turn on notifications</Button>
              )}
              {prefs.pushConfigured && (
                <Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending || prefs.devices === 0}>
                  <Send className="mr-1.5 h-4 w-4" />Send test push
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Events */}
      <section className="rounded-[.45rem] border border-border bg-[hsl(var(--card))]">
        <div className="border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-100">Alerts</h2>
          <p className="text-xs text-slate-500">Off = no push and no sound for that event. It still appears in the bell.</p>
        </div>
        <ul className="divide-y divide-slate-800">
          {prefs.categories.map((c) => {
            const info = NOTIFICATION_CATEGORY_INFO[c];
            const on = !muted.has(c);
            return (
              <li key={c} className="flex min-h-[52px] items-center gap-3 px-5 py-2.5">
                <span className="w-6 text-center text-base" aria-hidden>{info.emoji}</span>
                <label htmlFor={`notif-${c}`} className="flex-1 text-sm text-slate-200">{info.label}</label>
                <Switch id={`notif-${c}`} checked={on} onCheckedChange={(v) => toggle(c, v)} disabled={save.isPending} />
              </li>
            );
          })}
        </ul>
      </section>

      {/* Quiet hours */}
      <section className="rounded-[.45rem] border border-border bg-[hsl(var(--card))] p-5">
        <div className="flex items-center gap-3">
          <Moon className="h-5 w-5 text-cyan-300" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-slate-100">Quiet hours</h2>
            <p className="text-xs text-slate-500">No push and no sound during these hours (Pakistan time). The bell still updates.</p>
          </div>
          <Switch
            aria-label="Quiet hours"
            checked={quietOn}
            onCheckedChange={(v) => (v ? setQuiet(22 * 60, 8 * 60) : setQuiet(null, null))}
            disabled={save.isPending}
          />
        </div>
        {quietOn && (
          <div className="mt-4 flex flex-wrap items-center gap-3 pl-8 text-sm text-slate-300">
            <label className="flex items-center gap-2">From
              <input type="time" className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-slate-100"
                defaultValue={toTime(prefs.quietStart)} key={`s-${prefs.quietStart}`}
                onBlur={(e) => { const v = fromTime(e.target.value); if (v != null && v !== prefs.quietStart) setQuiet(v, prefs.quietEnd); }} />
            </label>
            <label className="flex items-center gap-2">to
              <input type="time" className="h-10 rounded-md border border-slate-700 bg-slate-950 px-3 text-slate-100"
                defaultValue={toTime(prefs.quietEnd)} key={`e-${prefs.quietEnd}`}
                onBlur={(e) => { const v = fromTime(e.target.value); if (v != null && v !== prefs.quietEnd) setQuiet(prefs.quietStart, v); }} />
            </label>
          </div>
        )}
      </section>
    </div>
  );
}
