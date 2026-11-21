"use client";

import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // only a reference is logged, never request content (ADD-070)
    console.error("render_error", error.digest);
  }, [error]);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center" role="alert">
      <h1 className="text-3xl font-extrabold">Something went wrong</h1>
      <p className="mt-2 text-muted">We hit a problem loading this page. Your data is safe. Please try again.</p>
      {error.digest && <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>}
      <button onClick={reset} className="btn btn-primary mt-6">Try again</button>
    </main>
  );
}
