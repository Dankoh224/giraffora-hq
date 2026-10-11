"use client";
import { useFormStatus } from "react-dom";

export function Submit({ children, pending, className = "btn primary", name, value }: {
  children: React.ReactNode; pending?: string; className?: string; name?: string; value?: string;
}) {
  const s = useFormStatus();
  const mine = !name || s.data?.get(name) === value;
  return (
    <button className={className} disabled={s.pending} name={name} value={value}>
      {s.pending && mine ? pending ?? "Trabajando…" : children}
    </button>
  );
}
