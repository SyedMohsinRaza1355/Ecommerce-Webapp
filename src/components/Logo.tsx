export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-bold text-lg" style={{ color: light ? "#fff" : "var(--text-primary)" }}>
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <rect width="28" height="28" rx="7" fill="var(--brand-primary)" />
        <path d="M8 9h12l-1.5 8H9.5L8 9Zm0 0-.7-2.5H5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="11" cy="21" r="1.4" fill="#fff" />
        <circle cx="18" cy="21" r="1.4" fill="#fff" />
      </svg>
      Storeforge
    </span>
  );
}
