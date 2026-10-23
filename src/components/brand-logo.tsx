export function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <img
      className={compact ? "brand-logo brand-logo-compact" : "brand-logo"}
      src="/brand/comsflow-logo.png"
      alt="ComsFlow"
      width={900}
      height={272}
      fetchPriority={compact ? "auto" : "high"}
    />
  );
}
