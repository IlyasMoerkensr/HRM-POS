/** Gegevens die naar de browser gaan (kassa-pc en telefoon). Alleen wat nodig is. */

export interface PosProduct {
  id: string;
  name: string;
  shortName: string | null;
  sku: string | null;
  categoryId: string | null;
  priceInclCents: number;
  vatCode: string;
  vatRateBp: number;
  revenueAccountCode: string;
  vatAccountCode: string | null;
  openPrice: boolean;
  favorite: boolean;
  color: string | null;
}

export interface PosCategory {
  id: string;
  name: string;
  color: string;
}

export interface PosUser {
  id: string;
  name: string;
  color: string;
  role: 'MEDEWERKER' | 'MANAGER' | 'ADMIN';
  hasPin: boolean;
  hasPhone: boolean;
}

export interface DrawerSettings {
  kickCode: string;
  baudRate: number;
  trigger: 'escpos' | 'dtr' | 'rts';
  keepPortOpen: boolean;
}

export interface CheckoutPayment {
  id: string;
  method: 'CASH' | 'MOLLIE';
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELED' | 'EXPIRED';
  amountCents: number;
  employeeName: string;
  mollieMode: 'API' | 'PUSH' | 'MANUAL' | null;
  changeCents: number | null;
  reason: string | null;
}

export interface CheckoutState {
  orderId: string;
  number: string | null;
  type: 'SALE' | 'CREDIT';
  status: 'OPEN' | 'PARKED' | 'PENDING_PAYMENT' | 'PAID' | 'VOIDED';
  totalInclCents: number;
  paidCents: number;
  pendingCents: number;
  remainingCents: number;
  payments: CheckoutPayment[];
  vatLines: { vatCode: string; vatRateBp: number; totalInclCents: number; vatCents: number; totalExclCents: number }[];
  lines: { description: string; quantity: number; totalInclCents: number }[];
}
