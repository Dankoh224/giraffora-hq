import Link from "next/link";
import { all } from "@/lib/db";
import { Submit } from "@/components/Submit";
import { outboxDecision } from "../actions";

const ICON: Record<string, string> = { email: "✉️", whatsapp: "💬", linkedin: "🔗", call: "📞", aviso: "🔔" };

export default async function Bandeja() {
  const pending = await all("SELECT o.*, a.name, a.emoji FROM outbox o LEFT JOIN agents a ON a.id=o.agent_id WHERE o.status='pending' ORDER BY o.created_at DESC");
  const recent = await all("SELECT o.*, a.name FROM outbox o LEFT JOIN agents a ON a.id=o.agent_id WHERE o.status!='pending' ORDER BY coalesce(o.decided_at,o.created_at) DESC LIMIT 20");

  return (
    <>
      <div className="page-head">
        <div><h1>Bandeja de salida</h1><div className="muted">Nada sale de Giraffora sin tu visto bueno. Edita, aprueba o descarta.</div></div>
      </div>
      {!process.env.N8N_OUTBOX_WEBHOOK && <div className="notice">n8n aún no está conectado: al aprobar, el mensaje queda "aprobado" para que lo copies y envíes tú. Configura <code>N8N_OUTBOX_WEBHOOK</code> para que se envíe solo.</div>}

      <div className="stack">
        {pending.map((o) => (
          <form key={o.id} action={outboxDecision} className="card">
            <input type="hidden" name="id" value={o.id} />
            <div className="row spread">
              <b>{ICON[o.channel] ?? "•"} {o.channel} → {o.recipient}</b>
              <span className="small muted">{o.emoji} {o.name} {o.task_id && <>· <Link href={`/tareas/${o.task_id}`}>ver tarea</Link></>}</span>
            </div>
            {o.subject && <div className="small" style={{ margin: "6px 0" }}><b>Asunto:</b> {o.subject}</div>}
            <textarea name="body" defaultValue={o.body} style={{ minHeight: 120, marginTop: 8 }} />
            <div className="row" style={{ marginTop: 8 }}>
              <Submit className="btn ok" name="decision" value="approve" pending="Enviando…">{o.channel === "aviso" ? "Visto" : "Aprobar y enviar"}</Submit>
              <Submit className="btn danger" name="decision" value="reject" pending="…">Descartar</Submit>
            </div>
          </form>
        ))}
        {!pending.length && <div className="card muted">No hay mensajes esperando aprobación.</div>}
      </div>

      {!!recent.length && (
        <section className="card" style={{ marginTop: 20 }}>
          <h2>Historial</h2>
          <ul className="list small">{recent.map((o) => (
            <li key={o.id}>{ICON[o.channel]} {o.recipient} — {o.name} <span className={`badge ${o.status === "sent" ? "b-done" : o.status === "rejected" ? "b-changes" : "b-review"}`}>{o.status}</span>
              <details><summary className="muted">ver</summary><pre style={{ whiteSpace: "pre-wrap" }}>{o.body}</pre></details></li>
          ))}</ul>
        </section>
      )}
    </>
  );
}
