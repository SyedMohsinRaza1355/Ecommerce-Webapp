"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", padding: "4rem 1rem" }}>
        <h1>Something went wrong</h1>
        <p>We hit a problem. Your data is safe. Please try again.</p>
        <button onClick={reset} style={{ padding: ".7rem 1.2rem", borderRadius: ".6rem", border: 0, background: "#4f46e5", color: "#fff", fontWeight: 700 }}>Try again</button>
      </body>
    </html>
  );
}
