// Copia todo el datawarehouse local (data/empresa.db) a Turso. Se puede correr más de una vez
// (INSERT OR REPLACE). Uso: npx tsx scripts/migrar-a-turso.ts <libsql://url> <token>
import { createClient } from "@libsql/client";

const [url, authToken] = process.argv.slice(2);
if (!url?.startsWith("libsql://") || !authToken) { console.log("Uso: migrar-a-turso <libsql://url> <token>"); process.exit(1); }

(async () => {
  // 1) Crear el esquema en Turso con el mismo código de la app
  process.env.DATABASE_URL = url;
  process.env.DATABASE_AUTH_TOKEN = authToken;
  const { all } = await import("../lib/db");
  await all("SELECT 1");
  const remote = createClient({ url, authToken });
  const local = createClient({ url: "file:data/empresa.db" });

  // 2) Copiar tabla por tabla
  const tables = (await local.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).rows.map((r) => String(r.name));
  for (const t of tables) {
    const res = await local.execute(`SELECT * FROM ${t}`);
    const cols = res.columns;
    if (t === "areas" || t === "agents" || t === "settings") await remote.execute(`DELETE FROM ${t}`); // reemplaza la semilla
    for (let i = 0; i < res.rows.length; i += 100) {
      await remote.batch(res.rows.slice(i, i + 100).map((row) => ({
        sql: `INSERT OR REPLACE INTO ${t}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`,
        args: cols.map((_, j) => row[j] as any),
      })), "write");
    }
    const n = (await remote.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n;
    console.log(`${t}: ${res.rows.length} local → ${n} en Turso`);
  }
})().catch((e) => { console.error(e.message); process.exitCode = 1; });
