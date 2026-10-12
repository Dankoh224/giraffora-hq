// Lo que Clara te pide que mires, en orden: junta correos importantes, respuestas listas para enviar,
// newsletters por aprobar, entregas con preguntas o errores, avisos de los agentes y tus pendientes.
import { all, chileNow } from "./db";
import { niches } from "./contacts";

export type Priority = { key: string; level: 1 | 2 | 3; icon: string; text: string; link: string; noticeId?: string; taskId?: string; when?: string };
export const LEVEL = { 1: "Urgente", 2: "Importante", 3: "Cuando puedas" } as const;

export async function priorities(): Promise<Priority[]> {
  const out: Priority[] = [];
  const nicheName = new Map((await niches()).map((n) => [n.id, n.name]));
  const { date } = chileNow();

  for (const n of await all("SELECT n.*, a.name FROM notices n LEFT JOIN agents a ON a.id=n.agent_id WHERE n.status='open' ORDER BY n.created_at DESC"))
    out.push({ key: `n${n.id}`, level: n.priority, icon: "📣", text: `${n.name ?? "El equipo"} avisa: ${n.title}`, link: n.link ?? "/", noticeId: n.id, when: n.created_at });

  for (const e of await all("SELECT * FROM emails WHERE status='nuevo' AND importance>=4 ORDER BY importance DESC, received_at DESC LIMIT 15"))
    out.push({ key: `e${e.id}`, level: e.importance >= 5 ? 1 : 2, icon: "📧",
      text: `Te escribió ${e.from_name || e.from_email} (${e.account}): ${e.summary} Te sugiero: ${e.suggested_action}`, link: `/correo#${e.id}`, when: e.received_at });

  const drafts = await all("SELECT o.*, e.from_name FROM outbox o LEFT JOIN emails e ON e.id=o.email_id WHERE o.status IN ('pending','approved') AND o.channel!='aviso'");
  for (const o of drafts)
    out.push({ key: `o${o.id}`, level: o.error ? 1 : 2, icon: o.channel === "email" ? "✍️" : "📤",
      text: o.error ? `No se pudo enviar el correo a ${o.recipient}: ${o.error}` : o.channel === "email"
        ? `Dejé lista la respuesta para ${o.from_name || o.recipient}. Revísala y envíala.` : `Hay un mensaje de ${o.channel} para ${o.recipient} esperando tu aprobación.`,
      link: o.channel === "email" && o.email_id ? `/correo#${o.email_id}` : "/bandeja", when: o.created_at });

  for (const c of await all("SELECT * FROM campaigns WHERE status='borrador' ORDER BY coalesce(send_at,'9999'), created_at")) {
    const soon = c.send_at && new Date(c.send_at).getTime() - Date.now() < 24 * 3600e3;
    const who = c.niche === "todos" ? "todos los suscriptores" : nicheName.get(c.niche) ?? c.niche;
    out.push({ key: `c${c.id}`, level: soon ? 1 : 2, icon: "📰",
      text: `Revisa el borrador del newsletter de ${who} ("${c.subject}") para poder enviarlo${c.send_at ? `; sale el ${new Date(c.send_at).toLocaleString("es-CL", { weekday: "long", hour: "2-digit", minute: "2-digit" })}` : ""}.`,
      link: `/newsletter/${c.id}`, when: c.created_at });
  }

  // Entregas: con preguntas para ti, o terminadas esperando tu revisión
  for (const t of await all(`SELECT t.id, t.title, t.priority, t.updated_at, a.name,
      (SELECT content FROM deliverables d WHERE d.task_id=t.id ORDER BY version DESC LIMIT 1) AS content
      FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.status='review' ORDER BY t.priority, t.updated_at DESC LIMIT 20`)) {
    const asks = String(t.content ?? "").includes("❓ Preguntas para el CEO");
    out.push({ key: `t${t.id}`, level: asks || t.priority === 1 ? 2 : 3, icon: asks ? "❓" : "👀",
      text: asks ? `${t.name} necesita que le respondas unas preguntas en "${t.title}".` : `${t.name} terminó "${t.title}". Revísalo y apruébalo o pídele cambios.`,
      link: `/tareas/${t.id}`, taskId: t.id, when: t.updated_at });
  }

  // Problemas: tareas cuyo último intento falló (ej. el desarrollo de una web que no compila)
  for (const r of await all(`SELECT t.id, t.title, a.name, r.error, r.finished_at FROM tasks t JOIN agents a ON a.id=t.agent_id
      JOIN runs r ON r.id=(SELECT id FROM runs WHERE task_id=t.id ORDER BY started_at DESC LIMIT 1)
      WHERE r.status='error' AND t.status IN ('queued','changes')`))
    out.push({ key: `r${r.id}`, level: 1, icon: "⚠️", text: `Hay un problema que corregir en "${r.title}" (${r.name}): ${String(r.error).slice(0, 160)}`, link: `/tareas/${r.id}`, taskId: r.id, when: r.finished_at });

  for (const t of await all("SELECT * FROM tenders WHERE status='nueva' AND can_comply IN ('si','parcial') AND (close_date IS NULL OR close_date>=?) ORDER BY close_date", [date])) {
    const days = t.close_date ? Math.ceil((new Date(String(t.close_date).slice(0, 10)).getTime() - new Date(date).getTime()) / 864e5) : null;
    out.push({ key: `l${t.id}`, level: days !== null && days <= 5 ? 1 : 2, icon: "🔎",
      text: `Gabriela encontró una licitación que ${t.can_comply === "si" ? "podemos cumplir" : "podríamos cumplir con brechas"}: "${t.name}" (${t.buyer ?? ""}${days !== null ? `, cierra en ${days} días` : ""}). ¿Preparamos la oferta?`,
      link: "/licitaciones", when: t.created_at });
  }

  for (const c of await all("SELECT * FROM contacts WHERE next_action_date IS NOT NULL AND next_action_date<=? AND coalesce(stage,'') NOT IN ('perdido') ORDER BY next_action_date LIMIT 15", [date]))
    out.push({ key: `k${c.id}`, level: c.next_action_date < date ? 1 : 2, icon: "🗂️",
      text: `${c.next_action_date < date ? "Atrasado" : "Hoy"}: ${c.next_action ?? "seguimiento"} con ${c.name}${c.company ? ` (${c.company})` : ""}.`, link: "/crm", when: c.next_action_date });

  for (const td of await all("SELECT * FROM todos WHERE done=0 AND due IS NOT NULL AND due<=? ORDER BY due", [date]))
    out.push({ key: `d${td.id}`, level: td.due < date ? 1 : 2, icon: "✅", text: `${td.due < date ? "Se te pasó" : "Vence hoy"}: ${td.text}`, link: "/#pendientes", when: td.due });

  for (const ev of await all("SELECT * FROM events WHERE source='calendar' AND substr(occurred_at,1,10)=? AND occurred_at>=? ORDER BY occurred_at", [date, new Date().toISOString()]))
    out.push({ key: `v${ev.id}`, level: 2, icon: "📅", text: `Hoy ${new Date(ev.occurred_at).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" })}: ${ev.title}${ev.from_name ? ` con ${ev.from_name}` : ""}`, link: "/datos", when: ev.occurred_at });

  return out.sort((a, b) => a.level - b.level || String(b.when).localeCompare(String(a.when)));
}

// Texto compacto para que Clara sepa en qué estás cuando conversa contigo.
export async function prioritiesText(limit = 15) {
  const list = await priorities();
  return list.length ? list.slice(0, limit).map((p, i) => `${i + 1}. [${LEVEL[p.level]}] ${p.text}`).join("\n") : "No hay nada pendiente para el CEO.";
}
