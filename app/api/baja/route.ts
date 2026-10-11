// Link público de baja de los correos masivos (GET desde el correo, POST = baja en un clic de Gmail).
import { get, newId, now, run } from "@/lib/db";

async function unsubscribe(req: Request) {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!t || t === "prueba" || t === "vista-previa") return;
  const c = await get("SELECT id, name, email, niches, subscribed FROM contacts WHERE token=?", [t]);
  if (!c || !c.subscribed) return;
  // Baja inmediata + registro (fecha) + aviso informativo en tus prioridades. Queda en la lista de exclusión
  // para que nunca vuelva a recibir envíos aunque se reimporte.
  await run("UPDATE contacts SET subscribed=0, unsubscribed_at=? WHERE id=?", [now(), c.id]);
  await run("INSERT INTO notices(id,agent_id,priority,title,link,created_at) VALUES(?,'editor-newsletter',3,?,'/contactos?e=baja',?)",
    [newId(), `${c.name ?? c.email} (${c.niches ?? "sin nicho"}) se dio de baja del newsletter.`, now()]);
}

export async function GET(req: Request) {
  await unsubscribe(req);
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="font-family:system-ui;background:#faf7f2;color:#2a2622;display:grid;place-items:center;min-height:90vh;text-align:center">
<div><div style="font-size:48px">🦒</div><h2>Listo, no recibirás más correos de Giraffora.</h2><p>Si fue un error, responde cualquier correo nuestro y te volvemos a sumar.</p></div></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(req: Request) {
  await unsubscribe(req);
  return new Response("ok");
}
