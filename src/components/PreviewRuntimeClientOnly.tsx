"use client";

import dynamic from "next/dynamic";

const PreviewRuntimePanel = dynamic(
  () => import("./PreviewRuntimePanel").then((module) => module.PreviewRuntimePanel),
  {
    ssr: false,
    loading: () => (
      <section className="panel wide previewRuntime" aria-label="Midnight Preview runtime loading">
        <div className="panelNumber">LIVE</div>
        <h3>Midnight Preview runtime</h3>
        <p>Loading browser-only Midnight cryptography and encrypted private state…</p>
      </section>
    ),
  },
);

export function PreviewRuntimeClientOnly() {
  return <PreviewRuntimePanel />;
}
