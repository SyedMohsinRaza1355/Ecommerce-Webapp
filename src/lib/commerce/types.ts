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
};

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
  shippingMinor: number;
  taxMinor: number;
  totalMinor: number;
  customer: { name: string; email: string; phone: string; address: string; city: string; notes?: string };
  state: OrderState;
  payment: { method: "card" | "cod"; state: PaymentState; intentRef?: string; refundedMinor: number; refunds: { id: string; amountMinor: number; at: Date }[] };
  stockReserved: boolean;
  flags?: { refundRequired?: boolean };
  history: { at: Date; kind: "order" | "payment" | "note"; from?: string; to?: string; by: string; note?: string }[];
  createdAt: Date;
  updatedAt: Date;
};
