import type { Metadata } from "next";
import PropsBoard from "@/components/snapshot/PropsBoard";
import { buildPropsBoardData } from "@/lib/snapshot/propsBoard";
import { getInitialSnapshotBoardViewData } from "@/lib/snapshot/query";
import { getSnapshotBoardDateString } from "@/lib/snapshot/time";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ULTOPS | Every NBA Player Prop",
  description: "Every NBA player prop line on today's slate with odds, projections, and recent results.",
};

type PropsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export default async function PropsPage({ searchParams }: PropsPageProps) {
  const params = searchParams ? await searchParams : undefined;
  const requestedDate = typeof params?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;
  const data = await getInitialSnapshotBoardViewData(requestedDate ?? getSnapshotBoardDateString());

  return <PropsBoard data={buildPropsBoardData(data)} renderedAt={Date.now()} />;
}
