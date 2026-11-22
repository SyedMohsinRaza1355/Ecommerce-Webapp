export type Locale = "en" | "ur";
export const LOCALES: Locale[] = ["en", "ur"];
export const dirOf = (l: Locale): "ltr" | "rtl" => (l === "ur" ? "rtl" : "ltr");
export const isLocale = (v: unknown): v is Locale => v === "en" || v === "ur";

const en = {
  home: "Home", shop: "Shop", cart: "Cart", search: "Search", searchPlaceholder: "Search products", all: "All",
  addToCart: "Add to cart", outOfStock: "Out of stock", inStock: "In stock", onlyLeft: "Only {n} left", price: "Price",
  quantity: "Quantity", remove: "Remove", subtotal: "Subtotal", shipping: "Shipping", tax: "Tax", discount: "Discount", total: "Total", free: "Free",
  checkout: "Checkout", continueShopping: "Continue shopping", emptyCart: "Your cart is empty", emptyCartHint: "Add something you like and it will show up here.",
  contact: "Contact", fullName: "Full name", email: "Email", phone: "Phone", address: "Delivery address", city: "City", notes: "Order notes (optional)",
  payment: "Payment", payCard: "Pay by card", payCod: "Cash on delivery", discountCode: "Discount code", apply: "Apply",
  placeOrder: "Place order", orderPlaced: "Thank you! Your order is placed", orderNumber: "Order number", status: "Status", trackOrder: "Track your order",
  noProducts: "No products found", noProductsHint: "Try a different search or category.", previous: "Previous", next: "Next", page: "Page",
  categories: "Categories", featured: "Featured products", viewAll: "View all", language: "Language", skip: "Skip to main content",
  payNow: "Pay now", paymentPage: "Secure payment page", simulateSuccess: "Simulate successful payment", simulateFail: "Simulate failed payment",
  paymentFailed: "Payment failed. You can try again.", tryAgain: "Try again", paymentReceived: "Payment received", awaitingPayment: "Waiting for payment",
  storeSuspended: "This store is temporarily unavailable", poweredBy: "Powered by Storeforge", privacy: "Privacy", terms: "Terms",
  cookieNotice: "We only use essential cookies to keep your cart and sign-in working.", ok: "OK", details: "Details", description: "Description",
  yourOrder: "Your order", items: "Items", timeline: "Order timeline", signIn: "Sign in", account: "Account", myAccount: "My account", signOut: "Sign out", createAccount: "Create account", wishlist: "Wishlist", adminArea: "Store admin",
};

const ur: typeof en = {
  home: "ہوم", shop: "دکان", cart: "ٹوکری", search: "تلاش", searchPlaceholder: "مصنوعات تلاش کریں", all: "تمام",
  addToCart: "ٹوکری میں شامل کریں", outOfStock: "اسٹاک ختم", inStock: "دستیاب", onlyLeft: "صرف {n} باقی", price: "قیمت",
  quantity: "مقدار", remove: "ہٹائیں", subtotal: "ذیلی کل", shipping: "ڈیلیوری", tax: "ٹیکس", discount: "رعایت", total: "کل", free: "مفت",
  checkout: "چیک آؤٹ", continueShopping: "خریداری جاری رکھیں", emptyCart: "آپ کی ٹوکری خالی ہے", emptyCartHint: "جو پسند آئے شامل کریں، وہ یہاں نظر آئے گا۔",
  contact: "رابطہ", fullName: "پورا نام", email: "ای میل", phone: "فون", address: "ڈیلیوری کا پتہ", city: "شہر", notes: "آرڈر کے نوٹس (اختیاری)",
  payment: "ادائیگی", payCard: "کارڈ سے ادائیگی", payCod: "کیش آن ڈیلیوری", discountCode: "رعایتی کوڈ", apply: "لاگو کریں",
  placeOrder: "آرڈر دیں", orderPlaced: "شکریہ! آپ کا آرڈر موصول ہو گیا", orderNumber: "آرڈر نمبر", status: "حالت", trackOrder: "آرڈر ٹریک کریں",
  noProducts: "کوئی مصنوعات نہیں ملیں", noProductsHint: "کوئی اور تلاش یا زمرہ آزمائیں۔", previous: "پچھلا", next: "اگلا", page: "صفحہ",
  categories: "زمرے", featured: "نمایاں مصنوعات", viewAll: "سب دیکھیں", language: "زبان", skip: "مرکزی مواد پر جائیں",
  payNow: "ابھی ادا کریں", paymentPage: "محفوظ ادائیگی کا صفحہ", simulateSuccess: "کامیاب ادائیگی کا تجربہ", simulateFail: "ناکام ادائیگی کا تجربہ",
  paymentFailed: "ادائیگی ناکام ہوئی۔ آپ دوبارہ کوشش کر سکتے ہیں۔", tryAgain: "دوبارہ کوشش کریں", paymentReceived: "ادائیگی موصول ہوئی", awaitingPayment: "ادائیگی کا انتظار",
  storeSuspended: "یہ دکان عارضی طور پر دستیاب نہیں", poweredBy: "Storeforge کے ذریعے", privacy: "پرائیویسی", terms: "شرائط",
  cookieNotice: "ہم صرف ضروری کوکیز استعمال کرتے ہیں تاکہ آپ کی ٹوکری اور سائن ان کام کرتے رہیں۔", ok: "ٹھیک ہے", details: "تفصیلات", description: "تفصیل",
  yourOrder: "آپ کا آرڈر", items: "اشیاء", timeline: "آرڈر کی ٹائم لائن", signIn: "سائن ان", account: "اکاؤنٹ", myAccount: "میرا اکاؤنٹ", signOut: "سائن آؤٹ", createAccount: "اکاؤنٹ بنائیں", wishlist: "پسندیدہ", adminArea: "اسٹور ایڈمن",
};

export type Key = keyof typeof en;
export const DICT: Record<Locale, Record<Key, string>> = { en, ur };

export function t(locale: Locale, key: Key, vars?: Record<string, string | number>): string {
  let s = DICT[locale]?.[key] ?? en[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Locale-aware money text from minor units. Digits switch to Arabic-Indic only for Urdu if desired later. */
export function fmtMoney(minor: number, currency: string, locale: Locale): string {
  const exp = currency === "JPY" ? 0 : currency === "KWD" ? 3 : 2;
  try {
    return new Intl.NumberFormat(locale === "ur" ? "ur-PK" : "en-US", { style: "currency", currency, minimumFractionDigits: exp, maximumFractionDigits: exp }).format(minor / 10 ** exp);
  } catch {
    return `${currency} ${(minor / 10 ** exp).toFixed(exp)}`;
  }
}

/** Dates are shown in the store's timezone (default Asia/Karachi, set APP_TIMEZONE to change), not the server's. */
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Karachi";

export function fmtDate(d: Date | string, locale: Locale, timeZone: string = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat(locale === "ur" ? "ur-PK" : "en-GB", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(d));
}
