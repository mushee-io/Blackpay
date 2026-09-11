"use client";

import dynamic from "next/dynamic";
import type { BlackpaySection } from "./BlackpayApp";

const BlackpayApp = dynamic(
  () => import("./BlackpayApp").then((module) => module.BlackpayApp),
  {
    ssr: false,
    loading: () => (
      <main className="routeLoading">
        <div className="eyebrow">BLACKPAY / PRIVATE PAYROLL</div>
        <h2>Loading secure workspace…</h2>
      </main>
    ),
  },
);

export function BlackpayAppClientOnly({ section = "dashboard" }: { section?: BlackpaySection }) {
  return <BlackpayApp section={section} />;
}
