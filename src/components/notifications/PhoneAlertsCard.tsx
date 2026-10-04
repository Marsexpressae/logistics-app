"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Button, Card, ErrorMessage } from "@/components/ui/form";
import { disablePush, enablePush, pushState, sendTestAlert, type PushState } from "@/lib/push";

/** Turn phone alerts on for THIS device. Each phone or browser is switched on separately. */
export default function PhoneAlertsCard() {
  const [state, setState] = useState<PushState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    pushState().then(setState, () => setState("unsupported"));
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await action();
      setState(await pushState());
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  if (state === null || state === "unsupported") return null; // nothing to offer on this device

  return (
    <Card className="mb-4 max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-start gap-3">
          <BellRing className="mt-0.5 h-5 w-5 text-blue-600" />
          <div>
            <p className="font-medium text-slate-900">Phone alerts</p>
            <p className="text-sm text-slate-600">
              {state === "on" && "On for this device. You get an alert even when the app is closed."}
              {state === "off" && "Get an alert on this device when a colleague mentions you or changes a pickup, even with the app closed."}
              {state === "denied" && "Alerts are blocked for this device. Allow notifications for this app in the browser or phone settings, then come back."}
              {state === "needs-install" && "On iPhone, add the app to your Home Screen first (Share, then Add to Home Screen), then open it from there."}
            </p>
          </div>
        </div>
        <span className="flex gap-2">
          {state === "off" && (
            <Button onClick={() => run(enablePush)} disabled={busy}>
              Turn on
            </Button>
          )}
          {state === "on" && (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const n = await sendTestAlert();
                    setNote(n ? "Test alert sent. It should arrive in a moment." : "No device was reached. Try turning alerts off and on again.");
                  })
                }
              >
                Send a test
              </Button>
              <Button variant="secondary" onClick={() => run(disablePush)} disabled={busy}>
                Turn off
              </Button>
            </>
          )}
        </span>
      </div>
      {note && <p className="mt-2 text-sm text-green-700">{note}</p>}
      <ErrorMessage message={error} />
    </Card>
  );
}
