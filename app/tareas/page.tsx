import Link from "next/link";
import { all } from "@/lib/db";
import { Submit } from "@/components/Submit";
import { TaskMenu } from "@/components/TaskMenu";
import { createMission } from "../actions";

const COLS = [
  { k: ["queued"], t: "📥 En cola" },
  { k: ["working"], t: "⚙️ Trabajando" },
  { k: ["review"], t: "👀 Para revisar" },
  { k: ["changes"], t: "🔁 Con cambios" },
  { k: ["done"], t: "✅ Aprobadas" },
];

export default async function Tareas({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams;
  const archived = await all("SELECT t.*, a.name, a.emoji FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.status='archived' ORDER BY t.updated_at DESC LIMIT 300");
  const tasks = await all(`SELECT t.*, a.name, a.emoji, ar.name AS area FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id LEFT JOIN areas ar ON ar.id=a.area_id
    WHERE t.status!='archived' AND (t.status!='done' OR t.updated_at>=?) ORDER BY t.priority, t.updated_at DESC`, [new Date(Date.now() - 7 * 864e5).toISOString()]);
  const agents = await all("SELECT id, name, role, emoji FROM agents WHERE status='active' ORDER BY rank, name");

  return (
    <>
      <div className="page-head">
        <div><h1>Trabajo</h1><div className="muted">Cada tarea itera contigo: el agente entrega, tú comentas, vuelve a entregar… hasta que apruebas.</div></div>
        <div className="row">
          <Link href="/tareas" className={`btn sm ${ver !== "archivadas" ? "primary" : ""}`}>Tablero</Link>
          <Link href="/tareas?ver=archivadas" className={`btn sm ${ver === "archivadas" ? "primary" : ""}`}>🗄️ Archivadas ({archived.length})</Link>
        </div>
      </div>

      {ver === "archivadas" ? (
        <section className="card">
          {archived.length ? (
            <ul className="list">{archived.map((t) => (
              <li key={t.id} className="row spread" style={{ flexWrap: "nowrap" }}>
                <div style={{ minWidth: 0 }}><Link href={`/tareas/${t.id}`}><b>{t.title}</b></Link>
                  <div className="small muted">{t.emoji} {t.name ?? "sin asignar"} · archivada el {new Date(t.updated_at).toLocaleDateString("es-CL")}</div></div>
                <TaskMenu id={t.id} archived />
              </li>
            ))}</ul>
          ) : <p className="muted">No hay tareas archivadas.</p>}
          <p className="small muted" style={{ marginBottom: 0 }}>⋯ → Restaurar la devuelve al tablero · Eliminar la borra para siempre (con sus subtareas y entregas).</p>
        </section>
      ) : <>

      <div className="kanban">
        {COLS.map((c) => {
          const list = tasks.filter((t) => c.k.includes(t.status));
          return (
            <div key={c.t} className="col">
              <h3>{c.t} · {list.length}</h3>
              {list.map((t) => (
                <div key={t.id} className="tcard">
                  <Link href={`/tareas/${t.id}`} style={{ textDecoration: "none", display: "block", paddingRight: 22 }}>
                    <div style={{ fontWeight: 600 }}>{t.priority === 1 && "🔥 "}{t.title}</div>
                    <div className="small muted">{t.emoji} {t.name ?? "sin asignar"}{t.iteration > 0 && ` · v${t.iteration}`}</div>
                  </Link>
                  <TaskMenu id={t.id} />
                </div>
              ))}
            </div>
          );
        })}
      </div>

      <section className="card" style={{ marginTop: 20, maxWidth: 640 }}>
        <h2>Nueva tarea</h2>
        <form action={createMission}>
          <div className="field"><input name="title" placeholder="Título" required /></div>
          <div className="field"><textarea name="brief" placeholder="Brief: objetivo, contexto, formato de entrega, criterio de listo." /></div>
          <div className="row">
            <select name="agent_id" defaultValue="jefa-gabinete" style={{ flex: 1, minWidth: 200 }}>{agents.map((a) => <option key={a.id} value={a.id}>{a.emoji} {a.name} — {a.role}</option>)}</select>
            <select name="priority" defaultValue="2" style={{ width: 120 }}><option value="1">🔥 Alta</option><option value="2">Normal</option><option value="3">Baja</option></select>
            <label className="row small" style={{ margin: 0 }}><input type="checkbox" name="now" value="1" style={{ width: "auto" }} /> empezar ya</label>
            <Submit pending="Creando…">Crear</Submit>
          </div>
        </form>
      </section>
      </>}
    </>
  );
}
