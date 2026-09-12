import type { Metadata } from "next";
import { BlackoutInvoice } from "@/components/BlackoutInvoice";

export const metadata: Metadata = {
  title: "Blackout Invoice",
  description: "Confidential commercial invoicing and shielded settlement on Midnight.",
};

export default function BlackoutInvoicePage() {
  return <BlackoutInvoice />;
}
