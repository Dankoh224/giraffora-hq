import Link from "next/link";
import { notFound } from "next/navigation";
import { all } from "@/lib/db";
import { spaceById } from "@/lib/spaces";
import { TEMPLATES } from "@/lib/templates";
import { SpacesNav } from "@/components/SpacesNav";
import { Submit } from "@/components/Submit";
import { createMission } from "../../actions";

const STATUS: Record<string, string> = { queued: "en cola", working: "trabajando", review: "por revisar", changes: "con cambios", done: "aprobada" };

export default async function SpacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = spaceById(id);
  if (!sp) notFound();
  const marks = sp.areas.map(() => "?").join(",");
  const agents = await all(`SELECT * FROM agents WHERE status='active' AND area_id IN (${marks}) ORDER BY CASE rank WHEN 'director' THEN 0 WHEN 'senior' THEN 1 ELSE 2 END`, sp.areas);
  const tasks = await all(`SELECT t.id, t.title, t.status, t.updated_at, a.name, a.emoji FROM tasks t JOIN agents a ON a.id=t.agent_id
    WHERE a.area_id IN (${marks}) AND t.status IN ('queued','working','review','changes') ORDER BY t.priority, t.updated_at DESC LIMIT 30`, sp.areas);
  const hiredTpl = new Set(agents.map((a) => a.template_id));
  const suggested = TEMPLATES.filter((t) => sp.areas.includes(t.area) && !hiredTpl.has(t.id));

  return (
    <>
      <SpacesNav active={sp.id} />
      <div className="page-head">
        <div><h1>{sp.emoji} {sp.name}</h1><div className="muted">{sp.description}</div></div>
      </div>

      <div className="stats">
        {sp.modules.map((m) => (
          <Link key={m.href} href={m.href} className="stat"><b style={{ fontSize: "1.3rem" }}>{m.icon} {m.label}</b><span>{m.hint}</span></Link>
        ))}
      </div>

      <div className="grid g2">
        <section className="card">
          <h2>🦒 Pedirle a Clara algo de {sp.name}</h2>
          <form action={createMission}>
            <input type="hidden" name="agent_id" value="jefa-gabinete" />
            <input type="hidden" name="title" value={`[${sp.name}] encargo del CEO`} />
            <div className="field"><textarea name="brief" required placeholder={`Ej: ${id === "ventas" ? "haz seguimiento a todos los que cotizaron este mes" : id === "comercial" ? "busca licitaciones de capacitación docente en la RM" : "lo que necesites de este espacio"}`} /></div>
            <Submit pending="Enviando a Clara…">Encargar a Clara</Submit>
          </form>
        </section>

        <section className="card">
          <h2>👥 Equipo de {sp.name}</h2>
          {agents.length ? (
            <div className="stack">{agents.map((a) => (
              <Link key={a.id} href={`/agentes/${a.id}`} className="agent"><div className="avatar">{a.emoji}</div>
                <div><b>{a.name}</b><div className="small muted">{a.role}</div></div></Link>
            ))}</div>
          ) : <p className="muted">Aún no hay nadie. Pídele a Clara lo que necesites y ella contratará.</p>}
          {!!suggested.length && <p className="small muted" style={{ marginTop: 10 }}>Disponibles para contratar: {suggested.map((t) => `${t.name} (${t.role})`).join(" · ")}</p>}
        </section>

        <section className="card" style={{ gridColumn: "1 / -1" }}>
          <h2>🗂️ Trabajo en curso</h2>
          {tasks.length ? (
            <ul className="list">{tasks.map((t) => (
              <li key={t.id} className="row spread"><Link href={`/tareas/${t.id}`}>{t.emoji} {t.name}: {t.title}</Link><span className={`badge b-${t.status}`}>{STATUS[t.status]}</span></li>
            ))}</ul>
          ) : <p className="muted">Nada en curso en este espacio.</p>}
        </section>
      </div>
    </>
  );
}
