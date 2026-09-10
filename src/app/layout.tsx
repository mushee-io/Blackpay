import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Blackpay — Confidential Payroll",
  description: "Private salaries. Public proof. Confidential payroll on Midnight.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
