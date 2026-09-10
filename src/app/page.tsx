import { BlackpayApp } from "@/components/BlackpayApp";
import { PreviewRuntimePanel } from "@/components/PreviewRuntimePanel";
import { Milestones712 } from "@/components/Milestones712";

export default function HomePage() {
  return (
    <>
      <BlackpayApp />
      <section className="shell liveShell">
        <PreviewRuntimePanel />
      </section>
      <Milestones712 />
    </>
  );
}
