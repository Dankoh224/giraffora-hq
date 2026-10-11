import { all } from "@/lib/db";
import { addEvent } from "../actions";

export default async function Datos() {
  const events = await all("SELECT * FROM events ORDER BY occurred_at DESC LIMIT 50");
  const contacts = await all("SELECT * FROM contacts ORDER BY updated_at DESC LIMIT 100");
  const bySource = await all("SELECT source, COUNT(*) AS n FROM events GROUP BY source");

  return (
    <>
      <div className="page-head">
        <div><h1>Datawarehouse</h1><div className="muted">Todo lo que entra (correo, WhatsApp, calendario, Notion) y el CRM, en un solo lugar.</div></div>
        <div className="row">{bySource.map((s) => <span key={s.source} className="badge">{s.source}: {s.n}</span>)}</div>
      </div>

      <div className="grid g2">
        <section className="card">
          <h2>👥 CRM · {contacts.length} contactos recientes</h2>
          <ul className="list">{contacts.slice(0, 12).map((c) => <li key={c.id}><b>{c.name}</b> <span className="small muted">{c.email} · {c.niches ?? "sin nicho"} · {c.stage}</span></li>)}</ul>
          <a className="btn sm" href="/contactos">Gestionar contactos →</a>
        </section>

        <section className="card">
          <h2>📥 Eventos recientes</h2>
          <ul className="list">{events.map((e) => (
            <li key={e.id}><div className="row spread"><b>{e.title || "(sin título)"}</b><span className="badge">{e.source}</span></div>
              <div className="small muted">{e.from_name} · {e.category} · {new Date(e.occurred_at).toLocaleString("es-CL")}</div>
              {e.body && <div className="small">{String(e.body).slice(0, 200)}</div>}</li>
          ))}</ul>
          {!events.length && <p className="muted">Conecta n8n a <code>/api/ingest</code> para que lleguen tus correos, WhatsApp y calendario.</p>}
          <details style={{ marginTop: 12 }}><summary>＋ Agregar a mano (ej: una cita o un paquete que llegó)</summary>
            <form action={addEvent} style={{ marginTop: 10 }}>
              <div className="row">
                <select name="source" style={{ flex: 1 }}><option value="calendar">📅 cita</option><option value="manual">📝 nota</option><option value="whatsapp">💬 whatsapp</option><option value="gmail">✉️ correo</option><option value="compra">📦 compra</option></select>
                <select name="category" style={{ flex: 1 }}><option>cliente</option><option>estudiante</option><option>amigo</option><option>proveedor</option><option>otro</option></select>
              </div>
              <div className="field" style={{ marginTop: 8 }}><input name="title" placeholder="Título" required /></div>
              <div className="row"><input name="from_name" placeholder="De / con quién" style={{ flex: 1 }} /><input name="occurred_at" type="datetime-local" style={{ flex: 1 }} /></div>
              <div className="field" style={{ marginTop: 8 }}><textarea name="body" placeholder="Detalle" /></div>
              <button className="btn">Guardar</button>
            </form>
          </details>
        </section>
      </div>
    </>
  );
}
