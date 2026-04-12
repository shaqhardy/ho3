import Link from "next/link";

export function PrivacyFooter() {
  return (
    <footer className="py-4 text-center">
      <Link
        href="/privacy"
        className="text-xs text-muted hover:text-terracotta transition-colors"
      >
        Privacy Policy
      </Link>
    </footer>
  );
}
