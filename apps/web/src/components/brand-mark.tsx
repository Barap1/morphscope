import Link from "next/link";

export function MorphMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? "morph-mark morph-mark-compact" : "morph-mark"} aria-hidden="true">
      <span className="morph-mark-orbit" />
      <span className="morph-mark-core" />
      <span className="morph-mark-cross morph-mark-cross-horizontal" />
      <span className="morph-mark-cross morph-mark-cross-vertical" />
    </span>
  );
}

export function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/"
      className={compact ? "brand-lockup brand-lockup-compact" : "brand-lockup"}
      aria-label="MorphScope overview"
    >
      <MorphMark compact={compact} />
      <span className="brand-lockup-copy">
        <span className="brand-wordmark">
          MORPH<span>SCOPE</span>
        </span>
        <span className="brand-descriptor">agent observability</span>
      </span>
    </Link>
  );
}
