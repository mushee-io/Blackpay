import type { InvoiceStatus } from "./types";

const ALLOWED_TRANSITIONS: Readonly<Record<InvoiceStatus, readonly InvoiceStatus[]>> = {
  CREATED: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["FUNDED", "CANCELLED"],
  FUNDED: ["PAID"],
  PAID: [],
  CANCELLED: [],
};

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertInvoiceTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransitionInvoice(from, to)) throw new Error(`Invalid invoice transition: ${from} -> ${to}`);
}

export function allowedInvoiceTransitions(status: InvoiceStatus): readonly InvoiceStatus[] {
  return ALLOWED_TRANSITIONS[status];
}
