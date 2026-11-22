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
  /** table booking (F-118) */
  booking?: { capacity: number; maxParty: number; from: string; to: string; slotMinutes: number; daysAhead: number };
  /** extra delivery fee by order weight (F-064) */
  weightTiers?: { upToGrams: number; feeMinor: number }[];
  /** loyalty points (F-050): points earned per 100 spent, and what one point is worth in minor units */
  loyalty?: { earnPer100: number; pointMinor: number };
  /** customer groups with a standing discount (F-049) */
  groups?: { id: string; name: string; percentBps: number }[];
  /** referral programme (F-062): credit for the new customer and for the friend who invited them */
  referral?: { rewardMinor: number };
  /** shop WhatsApp number, digits (F-135) */
  whatsapp?: string;
  /** order of the home page blocks (F-083) */
  homeSections?: ("trust" | "categories" | "featured")[];
  /** the shop's Telegram alert bot (F-103); the token is stored encrypted */
  telegram?: { tokenEnc: string; chatId: string };
  /** old address -> new address (F-090) */
  redirects?: { from: string; to: string }[];
  /** bumped to invalidate the live spreadsheet links (F-104) */
  feedVersion?: number;
  /** which ways of getting an order are offered (F-017, F-034, F-016) */
  fulfilment?: { delivery?: boolean; pickup?: boolean; dineIn?: boolean };
  /** pickup points (F-072) */
  locations?: { id: string; name: string; address: string }[];
  /** pause new same-time orders when this many are being prepared (F-125) */
  maxActive?: number;
  /** shown on every product page (returns and refunds in one or two sentences) */
  returnNote?: string;
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

export type Category = { _id: string; instanceId?: string; name: string; slug: string; sortOrder?: number; availability?: import("./options").Availability };

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
  sku?: string;
  /** grams, used for weight-based delivery fees (F-064) */
  weightGrams?: number;
  seoTitle?: string;
  seoDescription?: string;
  /** size/colour variants with their own stock, and add-on groups (F-002, F-003, F-014, F-021) */
  options?: import("./options").OptionGroup[];
  /** extra pictures (F-006) */
  gallery?: string[];
  /** specification table (F-008) */
  attributes?: { name: string; value: string }[];
  /** a combo made of other products (F-004) */
  bundle?: { productId: string; qty: number }[];
  /** only orderable in this window (F-012) */
  availability?: import("./options").Availability;
  stock: number;
  trackStock: boolean;
  status: "draft" | "published";
  createdAt: Date;
  updatedAt: Date;
};

export type OrderItem = { productId: string; name: string; unitMinor: number; qty: number; lineMinor: number; /** chosen option ids */ sel?: string[]; /** bundle parts to put back in stock on cancel */ parts?: { productId: string; qty: number }[] };

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
  /** how the customer gets the order (missing means delivery) */
  fulfilment?: { type: "delivery" | "pickup" | "dine_in"; locationId?: string; locationName?: string; table?: string; scheduledFor?: Date };
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
  /** gift card, store credit and points used on this order (split payment) */
  rewards?: import("./rewards").Rewards;
  rewardsAwarded?: boolean;
  flags?: { refundRequired?: boolean };
  history: { at: Date; kind: "order" | "payment" | "note"; from?: string; to?: string; by: string; note?: string }[];
  createdAt: Date;
  updatedAt: Date;
};
