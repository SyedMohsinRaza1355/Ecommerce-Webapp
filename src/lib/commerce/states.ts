// Order and payment state machines (DEC-05, ADD-019, ADD-020). Kept separate on purpose.
export const ORDER_STATES = ["pending", "confirmed", "processing", "ready", "fulfilled", "completed", "cancelled"] as const;
export type OrderState = (typeof ORDER_STATES)[number];

export const PAYMENT_STATES = ["requires_payment", "cod_due", "captured", "failed", "partially_refunded", "refunded"] as const;
export type PaymentState = (typeof PAYMENT_STATES)[number];

const ORDER_NEXT: Record<OrderState, readonly OrderState[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["processing", "cancelled"],
  processing: ["ready", "fulfilled", "cancelled"],
  ready: ["fulfilled", "cancelled"],
  fulfilled: ["completed"],
  completed: [],
  cancelled: [],
};

const PAYMENT_NEXT: Record<PaymentState, readonly PaymentState[]> = {
  requires_payment: ["captured", "failed"],
  cod_due: ["captured", "failed"],
  failed: ["requires_payment", "captured"], // retry or a late success
  captured: ["partially_refunded", "refunded"],
  partially_refunded: ["partially_refunded", "refunded"],
  refunded: [],
};

export const canOrderMove = (from: OrderState, to: OrderState) => ORDER_NEXT[from]?.includes(to) ?? false;
export const canPaymentMove = (from: PaymentState, to: PaymentState) => PAYMENT_NEXT[from]?.includes(to) ?? false;
export const nextOrderStates = (from: OrderState): readonly OrderState[] => ORDER_NEXT[from] ?? [];
export const isTerminalOrder = (s: OrderState) => (ORDER_NEXT[s]?.length ?? 0) === 0;

/** Which staff roles may drive which order transitions (kitchen/ops can only do fulfilment steps). */
export function roleMayMoveOrder(role: string, to: OrderState): boolean {
  if (["store_owner", "manager", "super_admin"].includes(role)) return true;
  if (role === "cashier") return true;
  if (role === "kitchen_ops") return ["processing", "ready", "fulfilled"].includes(to);
  return false;
}
