"use client";

import dynamic from "next/dynamic";
import type { AdvancedSection } from "./Milestones712";

const Milestones712 = dynamic(
  () => import("./Milestones712").then((module) => module.Milestones712),
  {
    ssr: false,
    loading: () => (
      <main className="routeLoading">
        <div className="eyebrow">BLACKPAY / PRIVATE OPERATIONS</div>
        <h2>Loading encrypted payroll tools…</h2>
      </main>
    ),
  },
);

export function Milestones712ClientOnly({ section = "disclosures" }: { section?: AdvancedSection }) {
  return <Milestones712 section={section} />;
}
