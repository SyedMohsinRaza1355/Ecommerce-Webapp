import { TOGGLES } from "./catalog";

/**
 * Handler registry (SRS 7.3). Every catalogue toggle has a registered handler id.
 * `IMPLEMENTED` lists toggles whose behaviour exists in code; the rest stay
 * "planned" and are reported honestly in the explorer and in launch counts.
 */
export const REGISTERED_HANDLERS: ReadonlySet<string> = new Set(TOGGLES.map((d) => d.handler));

// Toggles with working behaviour in code. Everything else is registered but shown as "coming soon".
export const IMPLEMENTED: ReadonlySet<string> = new Set<string>([
  "F-001", "F-005", "F-019", "F-026", "F-027", "F-029", "F-030", "F-037", "F-038", "F-041", "F-042",
  "F-052", "F-053", "F-063", "F-065", "F-069", "F-073", "F-074", "F-075", "F-085", "F-086", "F-087",
  "F-092", "F-107", "F-108", "F-109", "F-113", "F-126", "F-137", "F-139", "F-140", "F-039", "F-040", "F-045", "F-046", "F-047", "F-048", "F-051", "F-133", "F-009", "F-010", "F-020", "F-032", "F-036", "F-070", "F-011", "F-096", "F-094", "F-095", "F-098", "F-058", "F-080", "F-078", "F-081", "F-061", "F-110", "F-111", "F-054", "F-056", "F-057", "F-022", "F-018", "F-071", "F-115", "F-114", "F-076", "F-079", "F-084", "F-059", "F-099", "F-142", "F-100", "F-101", "F-124", "F-015", "F-002", "F-003", "F-004", "F-006", "F-008", "F-012", "F-013", "F-014", "F-021", "F-016", "F-017", "F-034", "F-035", "F-125", "F-072", "F-122", "F-138","F-025","F-118","F-064","F-044","F-131","F-132","F-050","F-049","F-062","F-083","F-134","F-127","F-077","F-103","F-135","F-141","F-119","F-129","F-060","F-121","F-088","F-144","F-055","F-145","F-112","F-106","F-090","F-091","F-104",
]);
