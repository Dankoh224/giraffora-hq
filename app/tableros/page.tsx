import Link from "next/link";
import { all } from "@/lib/db";
import { SPACES, spaceOfArea } from "@/lib/spaces";
import { SpacesNav } from "@/components/SpacesNav";

// Tablero de la empresa: qué se está haciendo y cuánto avanza, por espacio, proyecto y agente (últimos 30 días).
const ST = ["queued", "working", "changes", "review", "done"] as const;
const LABEL: Record<string, string> = { queued: "En cola", working: "Trabajando", changes: "Con cambios", review: "Por revisar", done: "Aprobadas" };
const COLOR: Record<string, string> = { queued: "var(--info)", working: "var(--warn)", changes: "var(--bad)", review: "var(--accent)", done: "var(--ok)" };

function Bar({ counts }: { counts: Record<string, number> }) {
  const total = ST.reduce((a, s) => a + (counts[s] ?? 0), 0) || 1;
  return (
    <div style={{ display: "flex", height: 10, borderRadius: 99, overflow: "hidden", background: "var(--soft)" }}>
      {ST.map((s) => counts[s] ? <div key={s} title={`${LABEL[s]}: ${counts[s]}`} style={{ width: `${(counts[s] / total) * 100}%`, background: COLOR[s] }} /> : null)}
    </div>
  );
}

export default async function Tableros() {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const tasks = await all(`SELECT t.id, t.title, t.status, t.parent_id, t.updated_at, a.id AS agent_id, a.name, a.emoji, a.role, a.area_id
    FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.status!='archived' AND (t.status!='done' OR t.updated_at>=?)`, [since]);
  const errors = new Set((await all(`SELECT task_id FROM runs r WHERE status='error' AND started_at=(SELECT MAX(started_at) FROM runs x WHERE x.task_id=r.task_id)`)).map((r) => r.task_id));
  const count = (list: any[]) => Object.fromEntries(ST.map((s) => [s, list.filter((t) => t.status === s).length]));
  const pct = (list: any[]) => (list.length ? Math.round((list.filter((t) => t.status === "done").length / list.length) * 100) : 0);

  const bySpace = SPACES.map((sp) => ({ sp, list: tasks.filter((t) => spaceOfArea(t.area_id)?.id === sp.id) }));
  const projects = tasks.filter((t) => tasks.some((c) => c.parent_id === t.id)).map((p) => ({ p, kids: tasks.filter((c) => c.parent_id === p.id) }));
  const agents = [...new Map(tasks.filter((t) => t.agent_id).map((t) => [t.agent_id, t])).values()]
    .map((a) => ({ a, list: tasks.filter((t) => t.agent_id === a.agent_id) })).sort((x, y) => y.list.length - x.list.length);
  const stuck = tasks.filter((t) => errors.has(t.id) && t.status !== "done");
  const waiting = tasks.filter((t) => t.status === "review" && Date.now() - new Date(t.updated_at).getTime() > 2 * 864e5);

  return (
    <>
      <SpacesNav active="producto" />
      <div className="page-head">
        <div><h1>📊 Tableros</h1><div className="muted">Qué se está haciendo y cómo avanza (últimos 30 días). {tasks.length} tareas · {pct(tasks)}% aprobadas.</div></div>
        <div className="row small">{ST.map((s) => <span key={s} className="row" style={{ gap: 4 }}><i style={{ width: 10, height: 10, borderRadius: 3, background: COLOR[s], display: "inline-block" }} />{LABEL[s]}</span>)}</div>
      </div>

      {(!!stuck.length || !!waiting.length) && (
        <section className="card" style={{ marginBottom: 16, borderColor: "var(--bad)" }}>
          <h2>🚧 Trabado</h2>
          <ul className="list">
            {stuck.map((t) => <li key={t.id}>⚠️ <Link href={`/tareas/${t.id}`}>{t.title}</Link> <span className="small muted">— {t.name}: falló en su último intento</span></li>)}
            {waiting.map((t) => <li key={t.id}>👀 <Link href={`/tareas/${t.id}`}>{t.title}</Link> <span className="small muted">— {t.name}: espera tu revisión hace más de 2 días</span></li>)}
          </ul>
        </section>
      )}

      <div className="grid g3" style={{ marginBottom: 16 }}>
        {bySpace.map(({ sp, list }) => (
          <Link key={sp.id} href={`/espacio/${sp.id}`} className="card" style={{ textDecoration: "none" }}>
            <div className="row spread"><b>{sp.emoji} {sp.name}</b><span className="badge">{pct(list)}%</span></div>
            <div style={{ margin: "10px 0 6px" }}><Bar counts={count(list)} /></div>
            <div className="small muted">{list.length ? ST.filter((s) => count(list)[s]).map((s) => `${LABEL[s]} ${count(list)[s]}`).join(" · ") : "Sin trabajo en curso"}</div>
          </Link>
        ))}
      </div>

      <div className="grid g2">
        <section className="card">
          <h2>🧩 Proyectos (encargos con subtareas)</h2>
          {projects.length ? (
            <ul className="list">{projects.map(({ p, kids }) => (
              <li key={p.id}>
                <div className="row spread"><Link href={`/tareas/${p.id}`}><b>{p.title}</b></Link><span className="small muted">{kids.filter((k) => k.status === "done").length}/{kids.length} · {pct(kids)}%</span></div>
                <div style={{ marginTop: 6 }}><Bar counts={count(kids)} /></div>
                <div className="small muted" style={{ marginTop: 4 }}>{kids.map((k) => `${k.emoji ?? ""} ${k.name}`).join(" · ")}</div>
              </li>
            ))}</ul>
          ) : <p className="muted">Cuando Clara reparte un encargo entre varias agentes, aparece aquí como proyecto.</p>}
        </section>

        <section className="card">
          <h2>👥 Carga por agente</h2>
          <ul className="list">{agents.map(({ a, list }) => (
            <li key={a.agent_id}>
              <div className="row spread"><Link href={`/agentes/${a.agent_id}`}>{a.emoji} {a.name} <span className="small muted">{a.role}</span></Link><span className="small muted">{list.length} tareas</span></div>
              <div style={{ marginTop: 6 }}><Bar counts={count(list)} /></div>
            </li>
          ))}</ul>
          {!agents.length && <p className="muted">Sin actividad aún.</p>}
        </section>
      </div>
    </>
  );
}
