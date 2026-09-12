import type { Metadata } from "next";
import { BlackoutInvoiceClientOnly } from "@/components/BlackoutInvoiceClientOnly";

export const metadata: Metadata = {
  title: "Blackout Invoice",
  description: "Confidential commercial invoicing and shielded settlement on Midnight.",
};

export default function BlackoutInvoicePage() {
  return <BlackoutInvoiceClientOnly />;
}
