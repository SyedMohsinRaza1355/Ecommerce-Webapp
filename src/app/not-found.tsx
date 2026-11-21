import Link from "next/link";
import { Logo } from "@/components/Logo";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-4 text-center">
      <Logo />
      <h1 className="mt-8 text-5xl font-extrabold">404</h1>
      <p className="mt-2 text-lg font-semibold">We could not find that page.</p>
      <p className="mt-1 text-muted">The link may be old, or the store may no longer exist.</p>
      <Link href="/" className="btn btn-primary mt-6">Go to the home page</Link>
    </main>
  );
}
