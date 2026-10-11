import { NextResponse, type NextRequest } from "next/server";
import { authToken } from "./lib/auth";

export async function middleware(req: NextRequest) {
  const pass = process.env.APP_PASSWORD;
  if (!pass) return NextResponse.next(); // sin contraseña (uso local)
  const p = req.nextUrl.pathname;
  if (p.startsWith("/login") || p.startsWith("/api/ingest") || p.startsWith("/api/baja")) return NextResponse.next();
  if (req.cookies.get("ev_auth")?.value === (await authToken(pass))) return NextResponse.next();
  if (p.startsWith("/api/")) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = { matcher: ["/((?!_next/|favicon|icon|manifest).*)"] };
