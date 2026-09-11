"use client";

import dynamic from "next/dynamic";

const BlackpayApp = dynamic(
  () => import("./BlackpayApp").then((module) => module.BlackpayApp),
  {
    ssr: false,
    loading: () => (
      <main className="shell">
        <div className="eyebrow">BLACKPAY / EMPLOYER</div>
        <h2>Loading live payroll runtime…</h2>
      </main>
    ),
  },
);

export function BlackpayAppClientOnly() {
  return <BlackpayApp />;
}
