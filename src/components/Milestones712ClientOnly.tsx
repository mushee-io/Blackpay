"use client";

import dynamic from "next/dynamic";

const Milestones712 = dynamic(
  () => import("./Milestones712").then((module) => module.Milestones712),
  {
    ssr: false,
    loading: () => (
      <section className="shell">
        <div className="eyebrow">BLACKPAY / PRIVATE OPERATIONS</div>
        <h2>Loading encrypted payroll tools…</h2>
      </section>
    ),
  },
);

export function Milestones712ClientOnly() {
  return <Milestones712 />;
}
