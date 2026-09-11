"use client";

import dynamic from "next/dynamic";

const PremiumDashboard = dynamic(
  () => import("./PremiumDashboard").then((module) => module.PremiumDashboard),
  {
    ssr: false,
    loading: () => (
      <main className="premiumDashLoading">
        <span>BLACKPAY / EMPLOYER</span>
        <h1>Loading private payroll…</h1>
      </main>
    ),
  },
);

export function PremiumDashboardClientOnly() {
  return <PremiumDashboard />;
}
