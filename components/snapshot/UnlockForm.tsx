"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

export function UnlockForm(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextPath = useMemo(() => searchParams.get("next") ?? "/", [searchParams]);
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/unlock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ passcode }),
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Unlock failed");
      }

      router.replace(nextPath);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unlock failed";
      setError(message);
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="glass w-full max-w-md rounded-2xl p-8 shadow-2xl shadow-black/25">
      <h1 className="title-font text-3xl uppercase tracking-wide text-white">Unlock Board</h1>
      <p className="mt-3 text-sm text-slate-300">
        Private passcode gate for your snapshot dashboard.
      </p>

      <label className="mt-8 block text-xs uppercase tracking-[0.18em] text-slate-300" htmlFor="passcode">
        Passcode
      </label>
      <input
        id="passcode"
        type="password"
        value={passcode}
        onChange={(event) => setPasscode(event.target.value)}
        className="mt-2 w-full rounded-xl border border-cyan-300/25 bg-[#0d1630] px-4 py-3 text-white outline-none transition focus:border-cyan-300/60 focus:ring-2 focus:ring-cyan-300/20"
        placeholder="Enter access passcode"
        required
        autoFocus
      />

      {error ? <p className="mt-3 text-sm text-orange-300">{error}</p> : null}

      <button
        type="submit"
        disabled={pending}
        className="mt-6 w-full rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-3 text-sm font-bold uppercase tracking-[0.15em] text-slate-900 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {pending ? "Checking..." : "Enter Snapshot"}
      </button>
    </form>
  );
}
