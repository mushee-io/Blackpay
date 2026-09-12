"use client";

import dynamic from "next/dynamic";

const BlackoutInvoice = dynamic(
  () => import("./BlackoutInvoice").then((module) => module.BlackoutInvoice),
  {
    ssr: false,
    loading: () => (
      <main className="routeLoading">
        <div className="eyebrow">BLACKOUT / INVOICE / LIVE</div>
        <h2>Loading confidential settlement workspace…</h2>
      </main>
    ),
  },
);

export function BlackoutInvoiceClientOnly() {
  return <BlackoutInvoice />;
}
