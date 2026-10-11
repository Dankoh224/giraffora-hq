import { all } from "@/lib/db";
import { AREAS, RANKS, TEMPLATES } from "@/lib/templates";
import { SKILL_NAMES, TOOLS } from "@/lib/tools";
import { Submit } from "@/components/Submit";
import { hireCustomAction, hireTemplate } from "../../actions";

export default async function Contratar() {
  const hired = new Set((await all<{ template_id: string }>("SELECT template_id FROM agents WHERE status!='archived'")).map((r) => r.template_id));
  const areas = await all("SELECT id, name FROM areas ORDER BY created_at");
  const areaNames = [...new Set([...areas.map((a) => a.name), ...AREAS.map((a) => a.name)])];

  return (
    <>
      <div className="page-head">
        <div><h1>Contratar</h1><div className="muted">Cada agente es experto en una sola cosa. Contrata más cuando aparezca una tarea nueva.</div></div>
      </div>

      {AREAS.map((ar) => {
        const list = TEMPLATES.filter((t) => t.area === ar.id);
        if (!list.length) return null;
        return (
          <section key={ar.id}>
            <div className="area-head"><span>{ar.emoji}</span><div><h2 style={{ margin: 0 }}>{ar.name}</h2><div className="small muted">{ar.description}</div></div></div>
            <div className="grid g3">
              {list.map((t) => (
                <div key={t.id} className="card stack" style={{ padding: 14 }}>
                  <div className="row"><div className="avatar">{t.emoji}</div><div><b>{t.role}</b><div className="small muted">{t.name} · {t.rank}</div></div></div>
                  <div className="small">{t.prompt.split("\n")[0].slice(0, 160)}…</div>
                  {t.routine && <div className="small muted">⏰ Rutina diaria {t.routine_hour}:00</div>}
                  {t.runner === "claude-code" && <div className="small muted">🖥️ Trabaja en tu PC con Claude Code</div>}
                  <form action={hireTemplate}>
                    <input type="hidden" name="template_id" value={t.id} />
                    <Submit className={hired.has(t.id) ? "btn sm" : "btn primary sm"} pending="Contratando…">{hired.has(t.id) ? "Contratar otro" : "Contratar"}</Submit>
                  </form>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <section className="card" style={{ marginTop: 32 }}>
        <h2>✨ Crear un puesto a medida</h2>
        <form action={hireCustomAction}>
          <div className="grid g2">
            <div>
              <div className="row">
                <div className="field" style={{ width: 70 }}><label>Emoji</label><input name="emoji" placeholder="🤖" /></div>
                <div className="field" style={{ flex: 1 }}><label>Nombre</label><input name="name" required placeholder="Ej: Renata" /></div>
              </div>
              <div className="field"><label>Cargo</label><input name="role" required placeholder="Ej: Editora de video para YouTube" /></div>
              <div className="field"><label>Área (existente o nueva)</label>
                <input name="area" list="areas" required placeholder="Marketing" />
                <datalist id="areas">{areaNames.map((n) => <option key={n} value={n} />)}</datalist></div>
              <div className="field"><label>Rango</label>
                <select name="rank" defaultValue="senior">{Object.entries(RANKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
              <div className="field"><label>Dónde trabaja</label>
                <select name="runner" defaultValue={"cloud"}><option value="cloud">☁️ En la nube (también con el PC apagado)</option><option value="claude-code">🖥️ En mi PC con Claude Code (archivos, video, código)</option></select></div>
              <div className="field"><label>Habilidades</label>
                {SKILL_NAMES.map((k) => (
                  <label key={k} className="row" style={{ fontWeight: 400, color: "var(--text)", margin: "2px 0" }}>
                    <input type="checkbox" name="skills" value={k} defaultChecked={k === "web_search" || k === "read_url"} style={{ width: "auto" }} /> {TOOLS[k].label}
                  </label>
                ))}</div>
            </div>
            <div>
              <div className="field"><label>Instrucciones de su especialidad</label>
                <textarea name="prompt" required style={{ minHeight: 180 }} placeholder="Qué hace, cómo trabaja, qué entrega y con qué estándar de calidad." /></div>
              <div className="field"><label>Rutina diaria (opcional)</label><textarea name="routine" placeholder="Algo que debe hacer cada día sin que se lo pidas." /></div>
              <div className="row">
                <div className="field" style={{ flex: 1 }}><label>Hora de la rutina (Chile)</label><input name="routine_hour" type="number" min={0} max={23} placeholder="3" /></div>
                <div className="field" style={{ flex: 2 }}><label>Cerebro (opcional)</label><input name="model" placeholder="gemini:gemini-flash-latest" /></div>
              </div>
            </div>
          </div>
          <Submit pending="Contratando…">Contratar</Submit>
        </form>
      </section>
    </>
  );
}
