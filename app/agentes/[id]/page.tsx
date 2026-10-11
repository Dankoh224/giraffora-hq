import Link from "next/link";
import { notFound } from "next/navigation";
import { all } from "@/lib/db";
import { getAgent } from "@/lib/org";
import { RANKS } from "@/lib/templates";
import { SKILL_NAMES, TOOLS } from "@/lib/tools";
import { Chat } from "@/components/Chat";
import { Submit } from "@/components/Submit";
import { createMission, updateAgent } from "../../actions";

const STATUS: Record<string, string> = { queued: "en cola", working: "trabajando", review: "por revisar", changes: "con cambios", done: "aprobada", archived: "archivada" };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getAgent(id);
  if (!a) notFound();
  const areas = await all("SELECT id, name FROM areas ORDER BY created_at");
  const tasks = await all("SELECT id, title, status, iteration, updated_at FROM tasks WHERE agent_id=? ORDER BY updated_at DESC LIMIT 30", [id]);
  const msgs = (await all("SELECT role, content, meta FROM messages WHERE agent_id=? ORDER BY created_at DESC LIMIT 30", [id])).reverse()
    .map((m) => ({ role: m.role, content: m.content, tools: m.meta ? JSON.parse(m.meta).tools : undefined }));
  const skills: string[] = JSON.parse(a.skills);

  return (
    <>
      <div className="page-head">
        <div className="row">
          <div className="avatar" style={{ width: 56, height: 56, fontSize: "1.8rem" }}>{a.emoji}</div>
          <div><h1>{a.name}</h1><div className="muted">{a.role} · {a.rank}{a.runner === "claude-code" && " · 🖥️ trabaja en tu PC"}{a.status !== "active" && ` · ${a.status}`}</div></div>
        </div>
        <Link href="/equipo" className="btn">← Equipo</Link>
      </div>

      <div className="grid g2">
        <section className="card"><h2>💬 Conversar</h2><Chat agentId={a.id} agentName={a.name} initial={msgs} /></section>

        <div className="stack">
          <section className="card">
            <h2>📌 Encargarle una tarea</h2>
            <form action={createMission}>
              <input type="hidden" name="agent_id" value={a.id} />
              <div className="field"><input name="title" placeholder="Título" required /></div>
              <div className="field"><textarea name="brief" placeholder="Qué necesitas, para cuándo y cómo sabrás que está listo." /></div>
              <div className="row">
                <label className="row small" style={{ margin: 0 }}><input type="checkbox" name="now" value="1" style={{ width: "auto" }} /> empezar ya</label>
                <Submit pending="Trabajando…">Encargar</Submit>
              </div>
            </form>
          </section>

          <section className="card">
            <h2>🗂️ Sus tareas</h2>
            {tasks.length ? <ul className="list">{tasks.map((t) => (
              <li key={t.id} className="row spread"><Link href={`/tareas/${t.id}`}>{t.title}</Link><span className={`badge b-${t.status}`}>{STATUS[t.status]}</span></li>
            ))}</ul> : <p className="muted">Sin tareas todavía.</p>}
          </section>
        </div>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <details>
          <summary>⚙️ Perfil, habilidades y rutina</summary>
          <form action={updateAgent} style={{ marginTop: 14 }}>
            <input type="hidden" name="id" value={a.id} />
            <div className="grid g2">
              <div>
                <div className="row">
                  <div className="field" style={{ width: 70 }}><label>Emoji</label><input name="emoji" defaultValue={a.emoji ?? ""} /></div>
                  <div className="field" style={{ flex: 1 }}><label>Nombre</label><input name="name" defaultValue={a.name} /></div>
                </div>
                <div className="field"><label>Cargo</label><input name="role" defaultValue={a.role} /></div>
                <div className="row">
                  <div className="field" style={{ flex: 1 }}><label>Área</label>
                    <select name="area_id" defaultValue={a.area_id}>{areas.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
                  <div className="field" style={{ flex: 1 }}><label>Rango</label>
                    <select name="rank" defaultValue={a.rank}>{Object.keys(RANKS).map((k) => <option key={k}>{k}</option>)}</select></div>
                  <div className="field" style={{ flex: 1 }}><label>Estado</label>
                    <select name="status" defaultValue={a.status}><option value="active">activo</option><option value="paused">pausado</option><option value="archived">despedido</option></select></div>
                </div>
                <div className="field"><label>Dónde trabaja</label>
                <select name="runner" defaultValue={a.runner}><option value="cloud">☁️ En la nube (también con el PC apagado)</option><option value="claude-code">🖥️ En mi PC con Claude Code (archivos, video, código)</option></select></div>
                <div className="field"><label>Habilidades</label>
                  {SKILL_NAMES.map((k) => (
                    <label key={k} className="row" style={{ fontWeight: 400, color: "var(--text)", margin: "2px 0" }}>
                      <input type="checkbox" name="skills" value={k} defaultChecked={skills.includes(k)} style={{ width: "auto" }} /> {TOOLS[k].label}
                    </label>
                  ))}</div>
              </div>
              <div>
                <div className="field"><label>Instrucciones</label><textarea name="prompt" defaultValue={a.system_prompt} style={{ minHeight: 200 }} /></div>
                <div className="field"><label>Rutina diaria</label><textarea name="routine" defaultValue={a.routine ?? ""} /></div>
                <div className="row">
                  <div className="field" style={{ flex: 1 }}><label>Hora (Chile)</label><input type="number" min={0} max={23} name="routine_hour" defaultValue={a.routine_hour ?? ""} /></div>
                  <div className="field" style={{ flex: 2 }}><label>Cerebro</label><input name="model" defaultValue={a.model ?? ""} placeholder="por defecto" /></div>
                </div>
              </div>
            </div>
            <Submit pending="Guardando…">Guardar cambios</Submit>
          </form>
        </details>
      </section>
    </>
  );
}
