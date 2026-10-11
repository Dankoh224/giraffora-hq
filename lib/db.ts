import { createClient, type Client, type InValue } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { MIGRATIONS, SCHEMA } from "./schema";
import { seed } from "./seed";

// Un solo cliente para todo: archivo local (file:...) o Turso en la nube (libsql://...).
let client: Client | null = null;
let ready: Promise<void> | null = null;

export function rawClient(): Client {
  if (!client) {
    const url = process.env.DATABASE_URL || "file:data/empresa.db";
    if (url.startsWith("file:")) mkdirSync("data", { recursive: true });
    client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
  }
  return client;
}

async function init() {
  const c = rawClient();
  await c.executeMultiple(SCHEMA);
  for (const m of MIGRATIONS) await c.execute(m).catch(() => {}); // columnas nuevas; falla si ya existen
  const r = await c.execute("SELECT COUNT(*) AS n FROM areas");
  if (Number(r.rows[0].n) === 0) await seed(c);
}

async function db(): Promise<Client> {
  if (!ready) ready = init().catch((e) => { ready = null; throw e; });
  await ready;
  return rawClient();
}

export type Row = Record<string, any>;

export async function all<T = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
  const r = await (await db()).execute({ sql, args });
  return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))) as T[];
}

export async function get<T = Row>(sql: string, args: InValue[] = []): Promise<T | undefined> {
  return (await all<T>(sql, args))[0];
}

export async function run(sql: string, args: InValue[] = []) {
  return (await db()).execute({ sql, args });
}

export const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 12);
export const now = () => new Date().toISOString();

export async function setting(key: string): Promise<string> {
  return (await get<{ value: string }>("SELECT value FROM settings WHERE key=?", [key]))?.value ?? "";
}
export async function setSetting(key: string, value: string) {
  await run("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [key, value]);
}

// Hora y fecha en Chile, para rutinas y brief.
export function chileNow() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", hour12: false,
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}
