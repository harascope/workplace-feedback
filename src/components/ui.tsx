"use client";

export function Notice({
  tone = "quiet",
  title,
  children,
  className = "",
}: {
  tone?: "quiet" | "warn" | "stop";
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const toneClass = tone === "warn" ? "notice--warn" : tone === "stop" ? "notice--stop" : "";
  return (
    <div className={`notice ${toneClass} ${className}`}>
      {title && <div className="notice-title">{title}</div>}
      <div className="body-text">{children}</div>
    </div>
  );
}

export function Btn({
  children,
  onClick,
  disabled,
  variant = "solid",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "solid" | "ghost" | "accent";
}) {
  return (
    <button className={`btn btn--${variant}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

export function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

/** カード内の一項目。ラベルと本文の組。 */
export function Field({
  label,
  children,
  muted = false,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div>
      <span className="label">{label}</span>
      <div className="body-text" style={muted ? { color: "var(--faint)" } : undefined}>
        {children}
      </div>
    </div>
  );
}
