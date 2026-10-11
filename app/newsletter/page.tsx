import Link from "next/link";
import { all, setting } from "@/lib/db";
import { audience, niches } from "@/lib/contacts";
import { account } from "@/lib/mail";
import { config, DAYS } from "@/lib/newsletter";
import { Submit } from "@/components/Submit";
import { draftWeeklyNow, newCampaign, saveNewsletter, saveTemplateAction, setDefaultTemplate } from "../actions-mail";

const STATUS: Record<string, string> = { borrador: "b-review", aprobada: "b-queued", enviando: "b-working", enviada: "b-done" };

export default async function Newsletter() {
  const cfg = await config();
  const list = await niches();
  const campaigns = await all("SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 60");
  const sender = account(process.env.MAIL_ENVIOS);
  const total = (await audience("todos")).length;
  const templates = await all("SELECT name, updated_at FROM email_templates ORDER BY name");
  const def = (await setting("newsletter_template")) || "Giraffora básica";

  return (
    <>
      <div className="page-head">
        <div><h1>Newsletter</h1><div className="muted">Información de calidad para tu comunidad, por nicho, desde {sender?.user ?? "tu correo de empresa"}. Nada sale sin tu aprobación.</div></div>
      </div>
      {!sender && <div className="notice">Conecta tu cuenta de empresa (MAIL_n_USER/PASS) y define <code>MAIL_ENVIOS</code> con su etiqueta para poder enviar.</div>}
      {!process.env.APP_URL && <div className="notice">Sin <code>APP_URL</code> pública el link de baja funciona por respuesta ("BAJA"), que tu secretaria procesa sola. Cuando publiques la app en Vercel, agrega APP_URL para la baja con un clic.</div>}

      <div className="grid g2" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>📅 Newsletter semanal</h2>
          <form action={saveNewsletter}>
            <label className="row" style={{ color: "var(--text)" }}><input type="checkbox" name="active" value="1" defaultChecked={cfg.active} style={{ width: "auto" }} /> Activo</label>
            <div className="row">
              <div className="field" style={{ flex: 1 }}><label>Día de envío</label>
                <select name="day" defaultValue={cfg.day}>{DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></div>
              <div className="field" style={{ flex: 1 }}><label>Hora (Chile)</label><input type="number" name="hour" min={6} max={21} defaultValue={cfg.hour} /></div>
            </div>
            <div className="field"><label>Instrucción para esta semana (opcional)</label>
              <textarea name="instruction" defaultValue={cfg.instruction} placeholder="Ej: enfócate en IA para planificar clases; menciona el taller de noviembre." /></div>
            <label className="row small" style={{ color: "var(--text)", fontWeight: 400 }}><input type="checkbox" name="auto_send" value="1" defaultChecked={cfg.auto_send} style={{ width: "auto" }} />
              Enviar sin mi aprobación (no recomendado al comienzo)</label>
            <p className="small muted">Elisa escribe un artículo por nicho ({list.map((x) => x.name).join(", ")}) la noche antes y te quedan como borradores aquí y en el brief.</p>
            <div className="row"><button className="btn primary">Guardar</button></div>
          </form>
          <form action={draftWeeklyNow} style={{ marginTop: 8 }}><Submit className="btn" pending="Elisa está investigando y escribiendo…">📰 Escribir los de esta semana ahora</Submit></form>
        </section>

        <section className="card">
          <h2>✉️ Envío puntual</h2>
          <p className="small muted">También puedes pedírselo a Clara o a Elisa en el chat: <i>"haz un correo para ofrecer el curso X a todos los suscriptores"</i>.</p>
          <form action={newCampaign}>
            <div className="field"><input name="title" placeholder="Nombre interno (ej: Lanzamiento curso docentes)" /></div>
            <div className="field"><input name="subject" placeholder="Asunto" /></div>
            <div className="field"><select name="niche" defaultValue="todos"><option value="todos">Todos los suscriptores ({total})</option>
              {list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
            <Submit pending="Creando…">Crear borrador</Submit>
          </form>
        </section>
      </div>

      <section className="card" style={{ marginBottom: 16 }}>
        <h2>🎨 Plantillas de Giraffora</h2>
        <p className="small muted">Sube tus plantillas HTML o déjalas en <a href="/archivos?p=Newsletter%2FPlantillas">Archivos/Newsletter/Plantillas</a>.
          Marcadores: <code>{"{{contenido}}"}</code> (el texto), <code>{"{{nombre}}"}</code>, <code>{"{{asunto}}"}</code>, <code>{"{{fecha}}"}</code>, <code>{"{{baja_url}}"}</code>.
          Si una plantilla no trae el link de baja, se agrega solo al final.</p>
        <div className="grid g2">
          <form action={setDefaultTemplate} className="row">
            <label style={{ margin: 0 }}>Plantilla por defecto</label>
            <select name="template" defaultValue={def} style={{ flex: 1 }}><option>Giraffora básica</option>{templates.map((t) => <option key={t.name}>{t.name}</option>)}</select>
            <button className="btn sm">Usar</button>
          </form>
          <form action={saveTemplateAction} className="row">
            <input name="name" placeholder="Nombre" style={{ flex: 1 }} />
            <input type="file" name="file" accept=".html,.htm" style={{ flex: 2 }} />
            <Submit className="btn sm" pending="Subiendo…">Subir</Submit>
          </form>
        </div>
        {!!templates.length && <p className="small muted" style={{ marginBottom: 0 }}>Disponibles: {templates.map((t) => t.name).join(" · ")}</p>}
      </section>

      <section className="card">
        <h2>Envíos</h2>
        {campaigns.length ? (
          <ul className="list">{campaigns.map((c) => (
            <li key={c.id} className="row spread">
              <span><Link href={`/newsletter/${c.id}`}><b>{c.title}</b></Link><div className="small muted">{c.subject} · {c.niche}{c.send_at && c.status !== "enviada" ? ` · sale ${new Date(c.send_at).toLocaleString("es-CL")}` : ""}</div></span>
              <span className={`badge ${STATUS[c.status] ?? ""}`}>{c.status}{c.status === "enviada" ? ` · ${c.sent_count}` : ""}</span>
            </li>
          ))}</ul>
        ) : <p className="muted">Aún no hay envíos.</p>}
      </section>
    </>
  );
}
