import { BlackpayApp } from "@/components/BlackpayApp";
import { PreviewRuntimeClientOnly } from "@/components/PreviewRuntimeClientOnly";
import { Milestones712 } from "@/components/Milestones712";

export default function HomePage() {
  return (
    <>
      <BlackpayApp />
      <section className="shell liveShell">
        <PreviewRuntimeClientOnly />
      </section>
      <Milestones712 />
    </>
  );
}
