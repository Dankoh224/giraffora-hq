import Link from "next/link";
import { all } from "@/lib/db";
import { createArea } from "../actions";

export default async function Equipo() {
  const areas = await all("SELECT * FROM areas ORDER BY created_at");
  const agents = await all(`SELECT a.*, (SELECT COUNT(*) FROM tasks t WHERE t.agent_id=a.id AND t.status IN ('queued','changes','working')) AS busy,
    (SELECT COUNT(*) FROM tasks t WHERE t.agent_id=a.id AND t.status='review') AS review FROM agents a WHERE a.status!='archived'
    ORDER BY CASE a.rank WHEN 'director' THEN 0 WHEN 'senior' THEN 1 ELSE 2 END, a.created_at`);

  return (
    <>
      <div className="page-head">
        <div><h1>Equipo</h1><div className="muted">{agents.length} agentes en {areas.length} áreas</div></div>
        <Link href="/equipo/contratar" className="btn primary">＋ Contratar agente</Link>
      </div>

      {areas.map((ar) => {
        const list = agents.filter((a) => a.area_id === ar.id);
        return (
          <section key={ar.id}>
            <div className="area-head"><span>{ar.emoji}</span><div><h2 style={{ margin: 0 }}>{ar.name}</h2><div className="small muted">{ar.description}</div></div></div>
            <div className="grid g3">
              {list.map((a) => (
                <Link key={a.id} href={`/agentes/${a.id}`} className="agent">
                  <div className="avatar">{a.emoji}</div>
                  <div style={{ minWidth: 0 }}>
                    <b>{a.name}</b> {a.status === "paused" && <span className="badge">pausado</span>}
                    <div className="small muted">{a.role}</div>
                    <div className="row" style={{ marginTop: 6, gap: 6 }}>
                      <span className={`badge ${a.rank === "director" ? "b-director" : ""}`}>{a.rank}</span>
                      {a.busy > 0 && <span className="badge b-queued">{a.busy} en cola</span>}
                      {a.review > 0 && <span className="badge b-review">{a.review} por revisar</span>}
                      {a.routine && <span className="badge">rutina {a.routine_hour}:00</span>}
                    </div>
                  </div>
                </Link>
              ))}
              {!list.length && <Link href="/equipo/contratar" className="agent muted">＋ Contratar para esta área</Link>}
            </div>
          </section>
        );
      })}

      <section className="card" style={{ marginTop: 32, maxWidth: 560 }}>
        <h2>Crear un área nueva</h2>
        <form action={createArea}>
          <div className="row">
            <input name="emoji" placeholder="🏢" style={{ width: 70 }} />
            <input name="name" placeholder="Nombre del área" required style={{ flex: 1 }} />
          </div>
          <div className="field" style={{ marginTop: 8 }}><input name="description" placeholder="¿Qué hace esta área?" /></div>
          <button className="btn">Crear área</button>
        </form>
      </section>
    </>
  );
}
