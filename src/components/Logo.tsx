export function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-lg font-extrabold tracking-tight" style={{ color: light ? "#fff" : "var(--text-primary)" }}>
      <svg width="30" height="30" viewBox="0 0 28 28" aria-hidden="true">
        <defs>
          <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset="1" stopColor="#ec4899" />
          </linearGradient>
        </defs>
        <rect width="28" height="28" rx="8" fill="url(#lg)" />
        <path d="M8 9.5h12l-1.5 8H9.5L8 9.5Zm0 0-.7-2.5H5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="11" cy="21" r="1.4" fill="#fff" />
        <circle cx="18" cy="21" r="1.4" fill="#fff" />
      </svg>
      Storeforge
    </span>
  );
}
