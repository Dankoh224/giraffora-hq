// Puerta de entrada al datawarehouse para n8n: correos, WhatsApp, calendario, Notion, compras…
// POST /api/ingest  (header x-ingest-secret)  body: un evento o una lista de eventos:
// { source, kind, from_name, from_contact, category, title, body, occurred_at, raw }
import { newId, now, run } from "@/lib/db";

export async function POST(req: Request) {
  if (!process.env.INGEST_SECRET || req.headers.get("x-ingest-secret") !== process.env.INGEST_SECRET)
    return Response.json({ error: "No autorizado" }, { status: 401 });
  const payload = await req.json();
  const items = Array.isArray(payload) ? payload : [payload];
  for (const e of items) {
    await run(
      "INSERT INTO events(id,source,kind,from_name,from_contact,category,title,body,occurred_at,raw,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      [newId(), e.source ?? "n8n", e.kind ?? null, e.from_name ?? null, e.from_contact ?? null, e.category ?? "sin_clasificar",
       e.title ?? null, String(e.body ?? "").slice(0, 20000), e.occurred_at ? new Date(e.occurred_at).toISOString() : now(),
       e.raw ? JSON.stringify(e.raw).slice(0, 50000) : null, now()],
    );
  }
  return Response.json({ ok: true, saved: items.length });
}
