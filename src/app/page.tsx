import { BlackpayAppClientOnly } from "@/components/BlackpayAppClientOnly";
import { PreviewRuntimeClientOnly } from "@/components/PreviewRuntimeClientOnly";
import { Milestones712ClientOnly } from "@/components/Milestones712ClientOnly";

export default function HomePage() {
  return (
    <>
      <BlackpayAppClientOnly />
      <section className="shell liveShell">
        <PreviewRuntimeClientOnly />
      </section>
      <Milestones712ClientOnly />
    </>
  );
}
