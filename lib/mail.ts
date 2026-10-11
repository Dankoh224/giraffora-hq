// Secretaria de correo: lee tus cuentas (IMAP), clasifica por importancia, redacta respuestas
// según tus instrucciones y las envía (SMTP) solo cuando tú apruebas.
// Cuentas en .env.local: MAIL_1_LABEL, MAIL_1_USER, MAIL_1_PASS (contraseña de aplicación), … hasta MAIL_5.
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer, { type Transporter } from "nodemailer";
import { all, get, newId, now, run, setting } from "./db";
import { chat } from "./llm";
import { getAgent, hireFromTemplate, type Agent } from "./org";

export type Account = { label: string; user: string; pass: string; imap: string; smtp: string; signature: string };

export function accounts(): Account[] {
  const out: Account[] = [];
  for (let i = 1; i <= 5; i++) {
    const user = process.env[`MAIL_${i}_USER`], pass = process.env[`MAIL_${i}_PASS`];
    if (!user || !pass) continue;
    out.push({
      label: process.env[`MAIL_${i}_LABEL`] || user, user, pass: pass.replace(/\s+/g, ""),
      imap: process.env[`MAIL_${i}_IMAP`] || "imap.gmail.com", smtp: process.env[`MAIL_${i}_SMTP`] || "smtp.gmail.com",
      signature: (process.env[`MAIL_${i}_FIRMA`] || "").replace(/\\n/g, "\n"),
    });
  }
  return out;
}
export const account = (label?: string | null) =>
  accounts().find((a) => a.label === label) ?? accounts().find((a) => a.label === (process.env.MAIL_ENVIOS || "")) ?? accounts().at(-1);

// ── 1. Leer correos nuevos ──
export async function fetchMail(log: (s: string) => void = () => {}) {
  let total = 0;
  for (const acc of accounts()) {
    const client = new ImapFlow({ host: acc.imap, port: 993, secure: true, auth: { user: acc.user, pass: acc.pass }, logger: false });
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const last = await get<{ t: string }>("SELECT MAX(received_at) AS t FROM emails WHERE account=?", [acc.label]);
        const since = last?.t ? new Date(new Date(last.t).getTime() - 864e5) : new Date(Date.now() - 2 * 864e5);
        const uids = ((await client.search({ since }, { uid: true })) || []).slice(-60);
        if (!uids.length) continue;
        for await (const msg of client.fetch(uids, { uid: true, source: { maxLength: 500_000 } as any }, { uid: true })) {
          if (!msg.source) continue;
          const p = await simpleParser(msg.source).catch(() => null);
          if (!p) continue;
          const messageId = p.messageId || `${acc.label}-${msg.uid}`;
          const from = p.from?.value?.[0];
          const r = await run(
            `INSERT OR IGNORE INTO emails(id,account,message_id,refs,from_name,from_email,to_addr,subject,body,received_at,created_at)
             VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
            [newId(), acc.label, messageId, [p.references].flat().filter(Boolean).join(" ") || null, from?.name || null,
             from?.address?.toLowerCase() || null, typeof p.to === "object" && "text" in (p.to as any) ? (p.to as any).text : null,
             p.subject || "(sin asunto)", (p.text || "").slice(0, 15000), (p.date ?? new Date()).toISOString(), now()],
          );
          total += r.rowsAffected;
        }
      } finally { lock.release(); }
      await client.logout();
    } catch (e: any) {
      log(`⚠️ ${acc.label}: ${e.message}`);
      await client.close();
    }
  }
  if (total) log(`📬 ${total} correos nuevos`);
  return total;
}

async function secretary(): Promise<Agent> {
  return (await getAgent("triage-correo")) ?? (await hireFromTemplate("triage-correo"));
}

// ── 2. Clasificar por importancia ──
export async function triageMail(log: (s: string) => void = () => {}) {
  const pending = await all("SELECT id, account, from_name, from_email, subject, substr(body,1,1500) AS body, received_at FROM emails WHERE importance IS NULL ORDER BY received_at LIMIT 40");
  if (!pending.length) return 0;
  const sec = await secretary();
  const company = await setting("company");
  const known = new Map((await all("SELECT lower(email) AS email, type, company FROM contacts WHERE email IS NOT NULL")).map((c) => [c.email, c]));
  for (let i = 0; i < pending.length; i += 10) {
    const batch: Record<string, any>[] = pending.slice(i, i + 10).map((e) => ({ ...e, contacto_conocido: known.get(e.from_email) ?? null }));
    const res = await chat([
      { role: "system", content: `${sec.system_prompt}\n\nContexto de la empresa del CEO:\n${company}` },
      { role: "user", content: `Clasifica estos correos que llegaron a las cuentas del CEO. Responde SOLO un JSON array, un objeto por correo:
{"id": "...", "importance": 1-5, "category": "cliente|estudiante|amigo|familia|aliado|proveedor|compra|evento|banco_tramite|newsletter|promocion|spam|baja|otro", "summary": "una línea: quién y qué quiere", "suggested_action": "acción concreta que recomiendas"}
Importancia: 5 = urgente o dinero/oportunidad hoy; 4 = requiere respuesta del CEO pronto; 3 = útil/responder esta semana; 2 = informativo; 1 = promoción o spam.
"baja" = la persona pide no recibir más correos.

${JSON.stringify(batch)}` },
    ], undefined, sec.model, "simple"); // clasificar = tarea simple → Haiku
    const text = String(res.message.content ?? "");
    let items: any[] = [];
    try { items = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1)); } catch { log("⚠️ la secretaria devolvió un formato inválido"); continue; }
    for (const it of items) {
      const imp = Math.min(5, Math.max(1, Number(it.importance) || 2));
      await run("UPDATE emails SET importance=?, category=?, summary=?, suggested_action=?, status=CASE WHEN ?<=1 THEN 'archivado' ELSE status END WHERE id=?",
        [imp, it.category ?? "otro", it.summary ?? "", it.suggested_action ?? "", imp, it.id]);
      const e = batch.find((b) => b.id === it.id);
      if (it.category === "baja" && e?.from_email)
      {
        const r = await run("UPDATE contacts SET subscribed=0, unsubscribed_at=? WHERE lower(email)=? AND subscribed=1", [now(), e.from_email]);
        if (r.rowsAffected) await run("INSERT INTO notices(id,agent_id,priority,title,link,created_at) VALUES(?,'triage-correo',3,?,'/contactos?e=baja',?)",
          [newId(), `${e.from_name ?? e.from_email} pidió la baja respondiendo un correo; ya quedó dado de baja.`, now()]);
      }
    }
  }
  log(`🗂️ ${pending.length} correos clasificados`);
  return pending.length;
}

// ── 3. Redactar respuesta según tu instrucción ──
export async function draftReply(emailId: string, instruction: string) {
  const e = await get("SELECT * FROM emails WHERE id=?", [emailId]);
  if (!e) throw new Error("Correo no existe");
  const acc = account(e.account);
  const sec = await secretary();
  const res = await chat([
    { role: "system", content: `${sec.system_prompt}\n\nEscribes en nombre del CEO, en primera persona, con su tono: cercano, claro y profesional. Contexto:\n${await setting("company")}` },
    { role: "user", content: `Correo recibido (cuenta ${e.account}):
De: ${e.from_name ?? ""} <${e.from_email}>
Asunto: ${e.subject}
---
${String(e.body).slice(0, 6000)}
---
Instrucción del CEO: ${instruction}

Escribe SOLO el cuerpo de la respuesta (sin "Asunto:", sin firma${acc?.signature ? "" : " salvo el nombre del CEO"}). Breve y lista para enviar.` },
  ], undefined, sec.model);
  const body = `${String(res.message.content ?? "").trim()}${acc?.signature ? `\n\n${acc.signature}` : ""}`;
  const subject = /^re:/i.test(e.subject) ? e.subject : `Re: ${e.subject}`;
  await run("DELETE FROM outbox WHERE email_id=? AND status='pending'", [emailId]);
  const id = newId();
  await run("INSERT INTO outbox(id,agent_id,channel,recipient,subject,body,account,email_id,created_at) VALUES(?,?,'email',?,?,?,?,?,?)",
    [id, sec.id, e.from_email, subject, body, e.account, emailId, now()]);
  await run("UPDATE emails SET status='pendiente', instruction=? WHERE id=?", [instruction, emailId]);
  return id;
}

// ── 4. Enviar (solo lo aprobado) ──
const transports = new Map<string, Transporter>();
export function transport(acc: Account) {
  if (!transports.has(acc.user))
    transports.set(acc.user, nodemailer.createTransport({ host: acc.smtp, port: 465, secure: true, auth: { user: acc.user, pass: acc.pass }, pool: true, maxConnections: 1 }));
  return transports.get(acc.user)!;
}

export async function sendOutboxEmail(outboxId: string) {
  const o = await get("SELECT * FROM outbox WHERE id=?", [outboxId]);
  if (!o) throw new Error("No existe");
  const acc = account(o.account);
  if (!acc) throw new Error("No hay cuentas de correo configuradas");
  const orig = o.email_id ? await get("SELECT message_id, refs FROM emails WHERE id=?", [o.email_id]) : null;
  try {
    await transport(acc).sendMail({
      from: acc.user, to: o.recipient, subject: o.subject || "(sin asunto)", text: o.body,
      ...(orig ? { inReplyTo: orig.message_id, references: [orig.refs, orig.message_id].filter(Boolean).join(" ") } : {}),
    });
    await run("UPDATE outbox SET status='sent', decided_at=?, error=NULL WHERE id=?", [now(), outboxId]);
    if (o.email_id) await run("UPDATE emails SET status='respondido' WHERE id=?", [o.email_id]);
  } catch (err: any) {
    await run("UPDATE outbox SET status='approved', error=? WHERE id=?", [err.message, outboxId]);
    throw err;
  }
}

// Correos aprobados que no se pudieron enviar en el momento (p. ej. aprobados desde el celular sin SMTP)
export async function flushApprovedEmails(log: (s: string) => void = () => {}) {
  for (const o of await all("SELECT id FROM outbox WHERE channel='email' AND status='approved'")) {
    try { await sendOutboxEmail(o.id); log("✉️ correo aprobado enviado"); } catch (e: any) { log(`⚠️ envío falló: ${e.message}`); }
  }
}

export async function mailCycle(log: (s: string) => void = () => {}) {
  if (!accounts().length) return;
  await fetchMail(log);
  await triageMail(log);
  await flushApprovedEmails(log);
}
