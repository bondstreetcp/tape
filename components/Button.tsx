import type { ButtonHTMLAttributes } from "react";

// Button system — one set of primitives so actions are consistent app-wide.
//   primary   = the accent action (white text on the strong accent)
//   secondary = bordered surface (the default)
//   ghost     = text-only, hover-tinted
type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md";

const VARIANT: Record<Variant, string> = {
  primary: "bg-[var(--accent-strong)] text-white hover:opacity-90",
  secondary: "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)]",
  ghost: "text-[var(--text-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]",
};
const SIZE: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3.5 py-2 text-sm",
};

export default function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return (
    <button
      {...props}
      className={
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 " +
        SIZE[size] +
        " " +
        VARIANT[variant] +
        (className ? " " + className : "")
      }
    />
  );
}
