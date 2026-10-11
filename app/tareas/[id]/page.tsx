import Link from "next/link";
import { notFound } from "next/navigation";
import { all, get } from "@/lib/db";
import { Markdown } from "@/components/Markdown";
import { Submit } from "@/components/Submit";
import { Uploader } from "@/components/Uploader";
import { filesAvailable, listDir, syncFiles, taskFolder } from "@/lib/files";
import { reassignTask, reviewTask, workNow } from "../../actions";

const STATUS: Record<string, string> = { queued: "en cola", working: "trabajando", review: "por revisar", changes: "con cambios pendientes", done: "aprobada", archived: "archivada" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await get("SELECT t.*, a.name, a.emoji, a.role, a.runner FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.id=?", [id]);
  if (!t) notFound();
  const versions = await all("SELECT * FROM deliverables WHERE task_id=? ORDER BY version DESC", [id]);
  const feedback = await all("SELECT * FROM feedback WHERE task_id=? ORDER BY created_at", [id]);
  const subs = await all("SELECT t.id, t.title, t.status, a.name, a.emoji FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE parent_id=?", [id]);
  const parent = t.parent_id ? await get("SELECT id, title FROM tasks WHERE id=?", [t.parent_id]) : null;
  const runs = await all("SELECT * FROM runs WHERE task_id=? ORDER BY started_at DESC LIMIT 10", [id]);
  const outbox = await all("SELECT * FROM outbox WHERE task_id=?", [id]);
  const agents = await all("SELECT id, name, role, emoji FROM agents WHERE status='active' ORDER BY rank, name");
  const [latest, ...older] = versions;
  const local = filesAvailable();
  if (local) await syncFiles();
  const folder = local ? await taskFolder(id) : t.folder;
  const files = local ? (await listDir(folder)).filter((e) => !["versiones", "imagenes", "entrega.md"].includes(e.name)) : [];
  const fileLink = (rel: string) => `/archivos?p=${encodeURIComponent(rel)}`;

  return (
    <>
      <div className="page-head">
        <div>
          {parent && <div className="small muted">↳ parte de <Link href={`/tareas/${parent.id}`}>{parent.title}</Link></div>}
          <h1>{t.title}</h1>
          <div className="row muted">
            <Link href={`/agentes/${t.agent_id}`}>{t.emoji} {t.name}</Link> · <span className={`badge b-${t.status}`}>{STATUS[t.status]}</span>
            {t.iteration > 0 && <span>· versión {t.iteration}</span>}
          </div>
        </div>
        <form action={workNow}>
          <input type="hidden" name="task_id" value={id} />
          <Submit className="btn" pending={`${t.name ?? "El agente"} está trabajando…`}>▶ Trabajar ahora</Submit>
        </form>
      </div>

      <div className="grid task-grid">
        <div className="stack">
          {t.brief && <section className="card"><h3>📝 Brief</h3><Markdown text={t.brief} /></section>}
          <section className="card">
            {latest ? (<><div className="small muted" style={{ marginBottom: 8 }}>Entrega v{latest.version}{latest.author === "ceo" && " · ✍️ editada por ti"} · {new Date(latest.created_at).toLocaleString("es-CL")}</div><Markdown text={latest.content} /></>)
              : <p className="muted">Todavía no hay entrega. Se trabajará en el próximo turno, o presiona "Trabajar ahora".</p>}
          </section>
          {older.map((v) => (
            <details key={v.id} className="card"><summary>Versión {v.version}{v.author === "ceo" && " (editada por ti)"}</summary><Markdown text={v.content} /></details>
          ))}
        </div>

        <div className="stack">
          <section className="card">
            <h2>Tu revisión</h2>
            <form action={reviewTask}>
              <input type="hidden" name="task_id" value={id} />
              <div className="field"><textarea name="body" placeholder="Comentarios, correcciones o instrucciones para la siguiente versión…" /></div>
              <div className="row">
                <Submit className="btn ok" name="decision" value="approve" pending="Guardando…">✓ Aprobar</Submit>
                <Submit className="btn primary" name="decision" value="redo" pending="Rehaciendo…">↻ Corregir ya</Submit>
                <Submit className="btn" name="decision" value="changes" pending="Guardando…">🌙 Corregir de noche</Submit>
                <Submit className="btn danger sm" name="decision" value="archive" pending="…">Archivar</Submit>
              </div>
            </form>
            {!!feedback.length && (
              <ul className="list small" style={{ marginTop: 12 }}>
                {feedback.map((f) => <li key={f.id}><b>{f.decision}</b> · {f.body || "—"} <span className="muted">{new Date(f.created_at).toLocaleDateString("es-CL")}</span></li>)}
              </ul>
            )}
          </section>

          <section className="card">
            <h3>📁 Carpeta de la tarea</h3>
            {t.runner === "claude-code" && <p className="small muted">🖥️ Este agente trabaja en tu PC con Claude Code: el worker local debe estar encendido.</p>}
            {local && folder ? (<>
              <div className="row" style={{ marginBottom: 8 }}><Link className="btn sm" href={fileLink(folder)}>Abrir carpeta</Link>
                {latest && <Link className="btn sm" href={`${fileLink(folder + "/entrega.md")}&edit=1`}>✏️ Editar entrega a mano</Link>}</div>
              {!!files.length && <ul className="list small">{files.map((e) => <li key={e.rel}><Link href={fileLink(e.rel)}>{e.dir ? "📁" : "📄"} {e.name}</Link></li>)}</ul>}
              <Uploader dir={folder} label="Adjuntar archivos para el agente" />
            </>) : <p className="small muted">La carpeta está en tu PC{folder ? `: Archivos/${folder}` : ""}.</p>}
          </section>

          {!!subs.length && (
            <section className="card"><h3>Delegado a</h3>
              <ul className="list">{subs.map((s) => <li key={s.id} className="row spread"><Link href={`/tareas/${s.id}`}>{s.emoji} {s.name}: {s.title}</Link><span className={`badge b-${s.status}`}>{STATUS[s.status]}</span></li>)}</ul>
            </section>
          )}

          {!!outbox.length && (
            <section className="card"><h3>Mensajes generados</h3>
              <ul className="list small">{outbox.map((o) => <li key={o.id}>{o.channel} → {o.recipient} <span className="badge">{o.status}</span></li>)}</ul>
              <Link href="/bandeja" className="btn sm">Ir a la Bandeja</Link>
            </section>
          )}

          <section className="card">
            <h3>Reasignar</h3>
            <form action={reassignTask} className="row">
              <input type="hidden" name="task_id" value={id} />
              <select name="agent_id" defaultValue={t.agent_id ?? ""} style={{ flex: 1 }}>{agents.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name} — {a.role}</option>)}</select>
              <button className="btn sm">OK</button>
            </form>
          </section>

          {!!runs.length && (
            <details className="card"><summary>🔍 Bitácora de trabajo</summary>
              {runs.map((r) => (
                <div key={r.id} className="small" style={{ marginTop: 10 }}>
                  <b>{new Date(r.started_at).toLocaleString("es-CL")}</b> · {r.status}
                  {r.error && <div style={{ color: "var(--bad)" }}>{r.error}</div>}
                  {r.log && <ul>{JSON.parse(r.log).map((l: any, i: number) => (
                    <li key={i}>{l.t === "tool" ? `🛠 ${l.name}(${JSON.stringify(l.args).slice(0, 120)})` : `🧠 ${l.model}`}</li>
                  ))}</ul>}
                </div>
              ))}
            </details>
          )}
        </div>
      </div>
    </>
  );
}
