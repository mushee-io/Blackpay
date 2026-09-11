"use client";

import dynamic from "next/dynamic";

const EmployeePortal = dynamic(
  () => import("./EmployeePortal").then((module) => module.EmployeePortal),
  {
    ssr: false,
    loading: () => (
      <main className="shell">
        <div className="eyebrow">BLACKPAY / EMPLOYEE</div>
        <h2>Loading private employee runtime…</h2>
      </main>
    ),
  },
);

export function EmployeePortalClientOnly() {
  return <EmployeePortal />;
}
