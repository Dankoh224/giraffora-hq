// Newsletter y envíos masivos desde tu propio correo (sin plataforma de mailing).
// - Cada semana, el Editor de Newsletter investiga y escribe un artículo por nicho → borradores.
// - Tú (o un agente) puedes crear envíos puntuales: "ofrece el curso X a todos los suscriptores".
// - Nada se envía sin tu aprobación (salvo que actives el envío automático del semanal).
// - Cada correo lleva link de baja, se envía de a uno con pausa y se puede retomar si se corta.
import { marked } from "marked";
import { all, chileNow, get, newId, now, run, setSetting, setting } from "./db";
import { audience, niches } from "./contacts";
import { runLoop } from "./engine";
import { account, transport } from "./mail";
import { getAgent, hireFromTemplate } from "./org";

export type NewsletterConfig = { day: number; hour: number; instruction: string; auto_send: boolean; active: boolean };
const DEFAULT_CFG: NewsletterConfig = { day: 2, hour: 9, instruction: "", auto_send: false, active: false };
export const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export async function config(): Promise<NewsletterConfig> {
  try { return { ...DEFAULT_CFG, ...JSON.parse((await setting("newsletter")) || "{}") }; } catch { return DEFAULT_CFG; }
}
export const saveConfig = (c: NewsletterConfig) => setSetting("newsletter", JSON.stringify(c));

export async function createCampaign(c: { title: string; subject: string; body: string; niche?: string; kind?: string; template?: string | null; agent_id?: string | null; task_id?: string | null; send_at?: string | null; status?: string }) {
  const id = newId();
  await run("INSERT INTO campaigns(id,title,niche,subject,body,status,kind,agent_id,task_id,send_at,template,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    [id, c.title, c.niche || "todos", c.subject, c.body, c.status || "borrador", c.kind || "puntual", c.agent_id ?? null, c.task_id ?? null, c.send_at ?? null, c.template ?? null, now()]);
  return id;
}

// Fecha/hora (ISO) del próximo envío semanal según la configuración (hora de Chile ≈ UTC-3).
function nextSendAt(cfg: NewsletterConfig) {
  const d = new Date();
  const chile = new Date(d.getTime() - 3 * 3600e3);
  let add = (cfg.day - chile.getUTCDay() + 7) % 7;
  if (add === 0 && chile.getUTCHours() >= cfg.hour) add = 7;
  const target = new Date(Date.UTC(chile.getUTCFullYear(), chile.getUTCMonth(), chile.getUTCDate() + add, cfg.hour + 3));
  return target.toISOString();
}

// La noche antes del envío semanal (desde las 00:00 del día anterior) se escriben los artículos.
export async function weeklyDrafts(log: (s: string) => void = () => {}, force = false) {
  const cfg = await config();
  if (!cfg.active && !force) return;
  const sendAt = nextSendAt(cfg);
  const hoursLeft = (new Date(sendAt).getTime() - Date.now()) / 3600e3;
  if (!force && hoursLeft > 34) return; // aún no toca
  if (!force && await get("SELECT id FROM campaigns WHERE kind='semanal' AND send_at=?", [sendAt])) return;

  const editor = (await getAgent("editor-newsletter")) ?? (await hireFromTemplate("editor-newsletter"));
  const { date } = chileNow();
  for (const n of await niches()) {
    log(`📰 Escribiendo newsletter ${n.name}`);
    const { text } = await runLoop(editor, [
      { role: "system", content: `${editor.system_prompt}\n\nHoy es ${date}.` },
      { role: "user", content: `Escribe el newsletter semanal de Giraffora para el nicho "${n.name}" (${n.desc}).
${cfg.instruction ? `Instrucción del CEO para esta semana: ${cfg.instruction}\n` : ""}
Investiga con web_search noticias y novedades REALES de los últimos 7 días sobre IA aplicada a este nicho (cita fuentes con links).
Formato de tu respuesta:
Línea 1: "ASUNTO: <asunto atractivo, máx 60 caracteres>"
Luego el cuerpo en Markdown: saludo con {{nombre}}, 1 artículo principal (300–450 palabras, práctico), 2–3 noticias breves con link, 1 tip accionable de IA para la semana, y un cierre cálido con invitación suave a los cursos de Giraffora.` },
    ], { agent: editor, questions: [] }, 10);
    const m = text.match(/ASUNTO:\s*(.+)/i);
    const subject = (m?.[1] ?? `Novedades de IA para ${n.name}`).replace(/[*"]/g, "").trim();
    const body = text.replace(/^[\s\S]*?ASUNTO:.*\n/i, "").trim();
    await createCampaign({ title: `Semanal ${n.name} — ${date}`, subject, body, niche: n.id, kind: "semanal", agent_id: editor.id, send_at: sendAt, status: cfg.auto_send ? "aprobada" : "borrador" });
  }
}

// ── Plantillas de Giraffora ──
// HTML con marcadores: {{contenido}} (el texto del correo), {{asunto}}, {{nombre}}, {{fecha}} y {{baja_url}}.
// Si la plantilla no trae {{baja_url}}, se agrega abajo el link "Darse de baja" (obligatorio por ley).
export const DEFAULT_TEMPLATE = `<!doctype html><html><body style="margin:0;background:#f6f3ee;font-family:Arial,Helvetica,sans-serif;color:#2a2622">
<div style="max-width:620px;margin:0 auto;padding:24px 16px">
<div style="font-size:22px;font-weight:bold;padding:8px 0 16px">🦒 Giraffora</div>
<div style="background:#ffffff;border-radius:12px;padding:28px 26px;line-height:1.6;font-size:16px">{{contenido}}</div>
<p style="font-size:12px;color:#7a7166;text-align:center;margin-top:18px">Recibes este correo porque eres parte de la comunidad Giraffora.<br>
<a href="{{baja_url}}" style="color:#7a7166">Darse de baja</a></p>
</div></body></html>`;

export async function templateHtml(name?: string | null) {
  const n = name || (await setting("newsletter_template"));
  if (!n || n === "Giraffora básica") return DEFAULT_TEMPLATE;
  return (await get<{ html: string }>("SELECT html FROM email_templates WHERE name=?", [n]))?.html ?? DEFAULT_TEMPLATE;
}

export function renderEmail(body: string, contact: { name?: string | null; token?: string | null; email?: string | null } | null, template = DEFAULT_TEMPLATE, subject = "") {
  const first = (contact?.name ?? "").split(" ")[0];
  const tag = (name: string) => new RegExp(`\{\{\s*${name}\s*\}\}`, "gi");
  const md = body.replace(tag("nombre"), first || "hola");
  const sender = account(process.env.MAIL_ENVIOS)?.user ?? "";
  const unsub = process.env.APP_URL && contact?.token
    ? `${process.env.APP_URL.replace(/\/$/, "")}/api/baja?t=${contact.token}`
    : `mailto:${sender}?subject=BAJA`;
  const footer = `<p style="font-size:12px;color:#7a7166;text-align:center;margin:18px 0"><a href="${unsub}" style="color:#7a7166">Darse de baja</a></p>`;
  let html = template
    .replace(tag("contenido"), marked.parse(md, { async: false }) as string)
    .replace(tag("asunto"), subject)
    .replace(tag("nombre"), first || "")
    .replace(tag("fecha"), new Date().toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" }));
  if (tag("baja_url").test(html)) html = html.replace(tag("baja_url"), unsub);
  else html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer}</body>`) : html + footer;
  return { html, text: `${md}\n\n---\nDarse de baja: ${unsub}`, unsub: unsub.startsWith("http") ? unsub : null };
}

// Envía las campañas aprobadas (las semanales solo desde su fecha). Se puede cortar y retomar.
export async function sendCampaigns(log: (s: string) => void = () => {}, maxPerRun = Number(process.env.MAX_EMAILS_PER_RUN || 400)) {
  const acc = account(process.env.MAIL_ENVIOS);
  if (!acc) return;
  let sent = 0;
  const due = await all("SELECT * FROM campaigns WHERE status IN ('aprobada','enviando') AND (send_at IS NULL OR send_at<=?) ORDER BY created_at", [now()]);
  for (const c of due) {
    await run("UPDATE campaigns SET status='enviando' WHERE id=?", [c.id]);
    const tpl = await templateHtml(c.template);
    const done = new Set((await all("SELECT contact_id FROM campaign_sends WHERE campaign_id=?", [c.id])).map((r) => r.contact_id));
    const todo = (await audience(c.niche)).filter((p) => !done.has(p.id));
    for (const p of todo) {
      if (sent >= maxPerRun) { log(`⏸️ pausa: ${sent} enviados en este turno, sigue en el próximo`); return; }
      if (!p.token) { p.token = newId() + newId(); await run("UPDATE contacts SET token=? WHERE id=?", [p.token, p.id]); }
      const { html, text, unsub } = renderEmail(c.body, p, tpl, c.subject);
      try {
        await transport(acc).sendMail({
          from: `Giraffora <${acc.user}>`, to: p.email, subject: c.subject.replace(/\{\{\s*nombre\s*\}\}/gi, (p.name ?? "").split(" ")[0]), html, text,
          headers: { "List-Unsubscribe": [unsub && `<${unsub}>`, `<mailto:${acc.user}?subject=BAJA>`].filter(Boolean).join(", "), ...(unsub ? { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {}) },
        });
        await run("INSERT OR REPLACE INTO campaign_sends(campaign_id,contact_id,status,sent_at) VALUES(?,?,'ok',?)", [c.id, p.id, now()]);
        await run("UPDATE contacts SET last_email_at=? WHERE id=?", [now(), p.id]);
        sent++;
      } catch (e: any) {
        const hard = /550|551|553|no such user|does not exist|invalid/i.test(e.message);
        if (hard) await run("UPDATE contacts SET bounced=1 WHERE id=?", [p.id]);
        await run("INSERT OR REPLACE INTO campaign_sends(campaign_id,contact_id,status,error,sent_at) VALUES(?,?,'error',?,?)", [c.id, p.id, e.message.slice(0, 300), now()]);
        if (/limit|quota|rate/i.test(e.message)) { log("⏸️ Gmail pidió pausa (límite diario); se retoma en el próximo turno"); return; }
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    const ok = await get<{ n: number }>("SELECT COUNT(*) AS n FROM campaign_sends WHERE campaign_id=? AND status='ok'", [c.id]);
    await run("UPDATE campaigns SET status='enviada', sent_count=?, sent_at=? WHERE id=?", [ok?.n ?? 0, now(), c.id]);
    log(`📨 "${c.title}" enviada a ${ok?.n ?? 0} personas`);
  }
}

export async function sendTest(campaignId: string) {
  const c = await get("SELECT * FROM campaigns WHERE id=?", [campaignId]);
  const acc = account(process.env.MAIL_ENVIOS);
  if (!c || !acc) throw new Error("Falta la campaña o la cuenta de envío");
  const { html, text } = renderEmail(c.body, { name: "Danko", token: "prueba" }, await templateHtml(c.template), c.subject);
  await transport(acc).sendMail({ from: `Giraffora <${acc.user}>`, to: acc.user, subject: `[PRUEBA] ${c.subject}`, html, text });
}
