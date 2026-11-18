export type IndustryPack = {
  id: string;
  name: string;
  description: string;
  version: number;
  /** recommended toggle states; defaults only, owners can change any of them (SRS 7.4) */
  toggles: Record<string, boolean>;
  categories: string[];
};

export const PACKS: IndustryPack[] = [
  {
    id: "restaurant", name: "Restaurant and food service", version: 1,
    description: "Menus, modifiers, combos, order types and a kitchen board.",
    toggles: { "F-003": true, "F-004": true, "F-012": true, "F-013": true, "F-014": true, "F-015": true, "F-017": true, "F-036": true, "F-124": true, "F-038": true },
    categories: ["Burgers", "Sides", "Drinks", "Desserts", "Deals"],
  },
  {
    id: "fashion", name: "Fashion and apparel", version: 1,
    description: "Sizes and colours, galleries, wishlists and reviews.",
    toggles: { "F-002": true, "F-006": true, "F-021": true, "F-048": true, "F-009": true, "F-010": true },
    categories: ["Women", "Men", "Kids", "Accessories", "Sale"],
  },
  {
    id: "grocery", name: "Grocery and mini-mart", version: 1,
    description: "Stock tracking, low-stock alerts, pickup and delivery.",
    toggles: { "F-019": true, "F-020": true, "F-017": true, "F-034": true, "F-038": true, "F-065": true },
    categories: ["Fruit and vegetables", "Dairy", "Bakery", "Snacks", "Household"],
  },
  {
    id: "electronics", name: "Electronics and gadgets", version: 1,
    description: "Specifications, comparisons, reviews and warranties.",
    toggles: { "F-008": true, "F-122": true, "F-009": true, "F-021": true, "F-066": true },
    categories: ["Phones", "Laptops", "Audio", "Accessories", "Smart home"],
  },
  {
    id: "services", name: "Services with bookings", version: 1,
    description: "Time slots, appointments and quote requests.",
    toggles: { "F-012": true, "F-118": true, "F-119": true, "F-035": true },
    categories: ["Consultations", "Packages", "Add-ons"],
  },
  {
    id: "digital", name: "Digital goods and creators", version: 1,
    description: "Instant downloads, subscriptions and gift cards.",
    toggles: { "F-007": true, "F-123": true, "F-044": true, "F-133": true },
    categories: ["Templates", "Courses", "Music", "Software"],
  },
  {
    id: "pharmacy", name: "Pharmacy and wellness", version: 1,
    description: "Stock tracking, refills and careful product details.",
    toggles: { "F-019": true, "F-020": true, "F-008": true, "F-034": true, "F-123": true },
    categories: ["Medicines", "Vitamins", "Personal care", "Devices"],
  },
  {
    id: "wholesale", name: "B2B wholesale and quotes", version: 1,
    description: "Customer groups, quote requests and bulk editing.",
    toggles: { "F-049": true, "F-119": true, "F-115": true, "F-101": true, "F-039": true },
    categories: ["Bulk items", "Samples", "Catalogues"],
  },
];

export const PACK_BY_ID: ReadonlyMap<string, IndustryPack> = new Map(PACKS.map((p) => [p.id, p]));
