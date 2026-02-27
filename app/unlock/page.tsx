import { Suspense } from "react";
import { UnlockForm } from "@/components/snapshot/UnlockForm";

export default function UnlockPage(): React.ReactElement {
  return (
    <main className="relative flex min-h-screen items-center justify-center px-6 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(34,211,238,0.18),transparent_45%),radial-gradient(circle_at_85%_5%,rgba(249,115,22,0.16),transparent_40%)]" />
      <div className="relative z-10 w-full max-w-md">
        <Suspense fallback={<div className="glass rounded-2xl p-8 text-sm text-slate-300">Loading unlock...</div>}>
          <UnlockForm />
        </Suspense>
      </div>
    </main>
  );
}
