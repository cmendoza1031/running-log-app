import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { ChevronLeft, X } from "lucide-react";
import { useLocation } from "wouter";
import { sportMeta } from "@/lib/vista";
import { IOSFeedbackManager } from "@/lib/ios-utils";

export function SportBadge({ sport, size = 36, className = "" }: { sport: string | null | undefined; size?: number; className?: string }) {
  const m = sportMeta(sport);
  const Icon = m.icon;
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-[30%] ${className}`}
      style={{ width: size, height: size, background: `${m.color}26`, boxShadow: `inset 0 0 0 1px ${m.color}40` }}
      aria-label={m.label}
    >
      <Icon size={size * 0.5} color={m.tint} strokeWidth={2.2} />
    </div>
  );
}

export function Card({ children, className = "", onClick, glow }: { children: ReactNode; className?: string; onClick?: () => void; glow?: boolean }) {
  const cls = `${glow ? "card-glow" : "card"} ${onClick ? "press cursor-pointer" : ""} ${className}`;
  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        className={cls}
        onClick={() => {
          void IOSFeedbackManager.lightImpact();
          onClick();
        }}
        onKeyDown={(e) => (e.key === "Enter" ? onClick() : undefined)}
      >
        {children}
      </div>
    );
  }
  return <div className={cls}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between px-1">
      <h2 className="text-[15px] font-semibold text-ink-1">{children}</h2>
      {action}
    </div>
  );
}

export function Stat({ label, value, unit, sub, color }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="eyebrow mb-1 flex items-center gap-1.5">
        {color && <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />}
        {label}
      </div>
      <div className="num flex items-baseline gap-1 text-[22px] font-semibold leading-none text-ink-1">
        {value}
        {unit && <span className="text-[13px] font-medium text-ink-3">{unit}</span>}
      </div>
      {sub && <div className="mt-1 text-[12px] text-ink-2">{sub}</div>}
    </div>
  );
}

export function Pill({ children, color, className = "" }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${className}`}
      style={color ? { background: `${color}22`, color } : { background: "rgba(255,255,255,0.08)", color: "var(--text-2)" }}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-xl bg-white/[0.06] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => {
            void IOSFeedbackManager.lightImpact();
            onChange(o.value);
          }}
          className={`flex-1 rounded-lg py-1.5 text-[13px] font-semibold transition-colors ${
            value === o.value ? "bg-white/[0.14] text-ink-1" : "text-ink-3"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, right, back }: { title: string; subtitle?: ReactNode; right?: ReactNode; back?: boolean }) {
  const [, navigate] = useLocation();
  return (
    <div className="page-top mb-3 flex items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? window.history.back() : navigate("/"))}
            className="press -ml-1.5 mb-2 flex items-center gap-0.5 text-[15px] font-medium text-primary"
          >
            <ChevronLeft size={20} /> Back
          </button>
        )}
        <h1 className="truncate text-[28px] font-bold leading-tight tracking-tight text-ink-1">{title}</h1>
        {subtitle && <div className="mt-0.5 text-[13px] text-ink-2">{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-8 text-center">
      {icon && <div className="mb-3 text-ink-3">{icon}</div>}
      <div className="text-[15px] font-semibold text-ink-1">{title}</div>
      {body && <div className="mt-1 text-[13px] leading-relaxed text-ink-2">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  className = "",
  variant = "primary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  type?: "button" | "submit";
}) {
  const styles = {
    primary: "bg-primary text-white shadow-[0_0_24px_rgba(10,132,255,0.35)]",
    secondary: "bg-white/[0.08] text-ink-1",
    danger: "bg-bad/15 text-bad",
    ghost: "text-primary",
  }[variant];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={() => {
        void IOSFeedbackManager.mediumImpact();
        onClick?.();
      }}
      className={`press flex h-12 items-center justify-center gap-2 rounded-2xl px-5 text-[15px] font-semibold disabled:opacity-40 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/** Bottom sheet with drag-to-dismiss. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  const controls = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative z-10 flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-[28px] border-t border-hairline bg-[#111113]"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            drag="y"
            dragControls={controls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 120 || info.velocity.y > 600) onClose();
            }}
          >
            <div className="flex shrink-0 touch-none items-center justify-between px-5 pb-2 pt-3" onPointerDown={(e) => controls.start(e)}>
              <div className="absolute left-1/2 top-2 h-1 w-9 -translate-x-1/2 rounded-full bg-white/20" />
              <div className="mt-3 min-w-0 text-[17px] font-semibold text-ink-1">{title}</div>
              <button type="button" onClick={onClose} className="press mt-3 rounded-full bg-white/10 p-1.5 text-ink-2" aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(24px,env(safe-area-inset-bottom))]">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Vista brand mark (matches the app icon). */
export function BrandMark({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-label="Vista" role="img" className="rounded-[22%] shadow-[0_0_40px_rgba(10,132,255,0.35)]">
      <defs>
        <radialGradient id="bm-glow" cx="50%" cy="46%" r="55%">
          <stop offset="0%" stopColor="#0A84FF" stopOpacity="0.38" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bm-v" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#64D2FF" />
          <stop offset="55%" stopColor="#0A84FF" />
          <stop offset="100%" stopColor="#5E5CE6" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="225" fill="#000" />
      <rect width="1024" height="1024" rx="225" fill="url(#bm-glow)" />
      <path d="M262 276 L512 752 L762 276" fill="none" stroke="url(#bm-v)" strokeWidth="128" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="392" cy="868" r="30" fill="#5AC8FA" />
      <circle cx="512" cy="868" r="30" fill="#C38BFF" />
      <circle cx="632" cy="868" r="30" fill="#FF8A47" />
    </svg>
  );
}

/** Digits → clock text, filled from the right like a stopwatch: "2430" → "24:30", "14530" → "1:45:30". */
export function formatClockDigits(raw: string, maxDigits: number): string {
  const d = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, maxDigits);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, -2)}:${d.slice(-2)}`;
  return `${d.slice(0, -4)}:${d.slice(-4, -2)}:${d.slice(-2)}`;
}

/** True when every segment after the first is 00-59. */
export function isValidClock(text: string): boolean {
  const parts = text.split(":");
  return parts.length >= 2 && parts.slice(1).every((p) => p.length === 2 && Number(p) < 60);
}

/** Numeric time input that inserts the colons itself (mm:ss, or h:mm:ss when `withHours`). */
export function ClockInput({
  value,
  onChange,
  withHours = false,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  withHours?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const invalid = value.length > 0 && value.includes(":") && !isValidClock(value);
  return (
    <input
      inputMode="numeric"
      autoComplete="off"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(formatClockDigits(e.target.value, withHours ? 6 : 4))}
      className={`${className} num ${invalid ? "!border-bad" : ""}`}
      aria-invalid={invalid}
    />
  );
}
