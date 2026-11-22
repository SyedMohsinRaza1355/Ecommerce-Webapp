import type { OrderState, PaymentState } from "./states";

export type Settings = {
  instanceId: string;
  configVersion: number;
  ownerToggles: Record<string, boolean>;
  branding: { storeName: string; primary: string; tagline: string; logoUrl: string };
  locale: "en" | "ur";
  currency: string;
  taxBps: number;
  shippingFlatMinor: number;
  freeShippingOverMinor: number | null;
  contactEmail: string;
  announcement?: string;
  /** weekly opening hours (F-018); a missing day means "closed" only when at least one day is set */
  hours?: Partial<Record<Day, { open: string; close: string } | null>>;
  /** delivery fee by city (F-071) */
  zones?: { id: string; name: string; cities: string[]; feeMinor: number }[];
  font?: "system" | "serif" | "rounded" | "mono";
  /** homepage banner slides (F-084) */
  hero?: { title: string; text: string; imageUrl: string; link: string }[];
};

export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAYS: Day[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const DEFAULT_SETTINGS: Omit<Settings, "instanceId" | "branding"> & { branding: Settings["branding"] } = {
  configVersion: 1,
  ownerToggles: {},
  branding: { storeName: "", primary: "#4f46e5", tagline: "", logoUrl: "" },
  locale: "en",
  currency: "PKR",
  taxBps: 0,
  shippingFlatMinor: 0,
  freeShippingOverMinor: null,
  contactEmail: "",
};

export type Category = { _id: string; instanceId?: string; name: string; slug: string; sortOrder?: number };

export type Product = {
  _id: string;
  instanceId?: string;
  name: string;
  slug: string;
  description: string;
  priceMinor: number;
  compareAtMinor?: number | null;
  categoryId?: string | null;
  imageUrl?: string;
  /** can be ordered even when stock is 0 (F-022) */
  backorder?: boolean;
  stock: number;
  trackStock: boolean;
  status: "draft" | "published";
  createdAt: Date;
  updatedAt: Date;
};

export type OrderItem = { productId: string; name: string; unitMinor: number; qty: number; lineMinor: number };

export type Order = {
  _id: string;
  instanceId?: string;
  orderNo: number;
  idempotencyKey: string;
  trackingHash: string;
  items: OrderItem[];
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  discountCode?: string;
  promo?: { id: string; name: string };
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  customer: { name: string; email: string; phone: string; address: string; city: string; notes?: string };
  state: OrderState;
  /** where the order came from; missing means the online shop */
  source?: "online" | "pos";
  cashierId?: string;
  customerId?: string;
  payment: {
    method: "card" | "cod" | "manual" | "pos";
    state: PaymentState;
    /** "test" = built-in pretend gateway, "stripe" = the owner's own Stripe account */
    provider?: "test" | "stripe";
    intentRef?: string;
    attempt?: number;
    stripe?: { sessionId?: string; paymentIntent?: string };
    /** in-store sale (cashier till): how the customer paid and the cash handed over */
    pos?: { tender: "cash" | "card" | "wallet"; receivedMinor?: number; changeMinor?: number };
    manual?: { methodId: string; label: string; kind: string; accountTitle: string; accountNumber: string; instructions: string; reference?: string; reportedAt?: Date };
    refundedMinor: number;
    refunds: { id: string; amountMinor: number; at: Date }[];
  };
  stockReserved: boolean;
  flags?: { refundRequired?: boolean };
  history: { at: Date; kind: "order" | "payment" | "note"; from?: string; to?: string; by: string; note?: string }[];
  createdAt: Date;
  updatedAt: Date;
};
