import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { get } from "@/lib/db";
import "./globals.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Giraffora HQ", description: "La empresa virtual de Giraffora", appleWebApp: { capable: true, title: "Giraffora HQ" } };
export const viewport: Viewport = { themeColor: "#d98a1f", width: "device-width", initialScale: 1 };

const NAV = [
  { href: "/", icon: "☀️", label: "Inicio", mobile: true },
  { href: "/correo", icon: "📧", label: "Correo", mobile: true },
  { href: "/tareas", icon: "🗂️", label: "Trabajo", mobile: true },
  { href: "/bandeja", icon: "📤", label: "Bandeja", mobile: true },
  { href: "/equipo", icon: "🦒", label: "Equipo", mobile: true },
  { href: "/newsletter", icon: "📰", label: "Newsletter" },
  { href: "/contactos", icon: "👥", label: "Contactos" },
  { href: "/archivos", icon: "📁", label: "Archivos" },
  { href: "/datos", icon: "🗄️", label: "Datos" },
  { href: "/ajustes", icon: "⚙️", label: "Ajustes" },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let counts: Record<string, number> = {};
  try {
    const review = await get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE status='review'");
    const outbox = await get<{ n: number }>("SELECT COUNT(*) AS n FROM outbox WHERE status='pending'");
    const mail = await get<{ n: number }>("SELECT COUNT(*) AS n FROM emails WHERE status='nuevo' AND importance>=4");
    const news = await get<{ n: number }>("SELECT COUNT(*) AS n FROM campaigns WHERE status='borrador'");
    counts = { "/tareas": review?.n ?? 0, "/bandeja": outbox?.n ?? 0, "/correo": mail?.n ?? 0, "/newsletter": news?.n ?? 0 };
  } catch { /* la página de login no necesita conteos */ }

  return (
    <html lang="es">
      <body>
        <div className="shell">
          <aside className="side">
            <Link href="/" className="brand"><span>🦒</span> Giraffora HQ</Link>
            <nav className="nav">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href}>
                  {n.icon} {n.label}
                  {!!counts[n.href] && <span className="badge b-review">{counts[n.href]}</span>}
                </Link>
              ))}
            </nav>
            <div style={{ marginTop: "auto" }} className="small muted">Tú eres el CEO.<br />Ellos trabajan de noche.</div>
          </aside>
          <main>{children}</main>
        </div>
        <nav className="bottom-nav">
          {NAV.filter((n) => n.mobile).map((n) => (
            <Link key={n.href} href={n.href}><span>{n.icon}</span>{n.label}{counts[n.href] ? ` (${counts[n.href]})` : ""}</Link>
          ))}
        </nav>
      </body>
    </html>
  );
}
