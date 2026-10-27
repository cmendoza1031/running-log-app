import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="page page-top flex flex-col items-center justify-center text-center">
      <div className="text-[48px] font-bold text-ink-3">404</div>
      <p className="mt-2 text-[15px] text-ink-2">This page doesn't exist.</p>
      <Link href="/" className="mt-6 rounded-2xl bg-primary px-5 py-3 text-[15px] font-semibold text-white">
        Back to Today
      </Link>
    </div>
  );
}
