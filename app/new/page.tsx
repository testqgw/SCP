import { Suspense } from "react";
import NewDashboard from "@/components/snapshot/NewDashboard";

export const dynamic = "force-dynamic";

function getBaseUrl() {
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

async function getBoardData() {
  const res = await fetch(`${getBaseUrl()}/api/snapshot/board`, {
    cache: "no-store",
  });

  if (!res.ok) throw new Error("Failed to fetch");

  const json = await res.json();
  return json.result;
}

async function NewDashboardPageContent() {
  const data = await getBoardData();
  return <NewDashboard data={data} />;
}

export default function NewDashboardPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-white">
          <div className="text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--surface-strong)] animate-pulse" />
            <p>Loading NewDashboard v1...</p>
          </div>
        </div>
      }
    >
      <NewDashboardPageContent />
    </Suspense>
  );
}
