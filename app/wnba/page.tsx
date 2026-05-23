import type { Metadata } from "next";
import WnbaDashboard, { type CurrentCard, type CurrentSettlement } from "./WnbaDashboard";
import currentCardData from "@/wnba/output/current-card.json";
import currentSettlementData from "@/wnba/output/current-settlement.json";

export const metadata: Metadata = {
  title: "ULTOPS | WNBA Player Prop Model",
  description: "WNBA player prop model section for the ULTOPS snapshot site.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function WnbaPage(): React.ReactElement {
  return (
    <WnbaDashboard
      card={currentCardData as CurrentCard}
      settlement={currentSettlementData as CurrentSettlement}
    />
  );
}
