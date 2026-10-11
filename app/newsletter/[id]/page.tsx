import Link from "next/link";
import { notFound } from "next/navigation";
import { all, get } from "@/lib/db";
import { audience, niches } from "@/lib/contacts";
import { renderEmail, templateHtml } from "@/lib/newsletter";
import { Submit } from "@/components/Submit";
import { campaignAction } from "../../actions-mail";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await get("SELECT * FROM campaigns WHERE id=?", [id]);
  if (!c) notFound();
  const list = await niches();
  const people = await audience(c.niche);
  const sent = await get<{ ok: number; err: number }>("SELECT SUM(status='ok') AS ok, SUM(status='error') AS err FROM campaign_sends WHERE campaign_id=?", [id]);
  const preview = renderEmail(c.body, { name: "Danko Ejemplo", token: "vista-previa" }, await templateHtml(c.template), c.subject).html;
  const templates = await all("SELECT name FROM email_templates ORDER BY name");
  const editable = ["borrador", "aprobada"].includes(c.status);

  return (
    <>
      <div className="page-head">
        <div><Link href="/newsletter" className="small muted">← Newsletter</Link><h1>{c.title}</h1>
          <div className="muted">{c.status} · para {c.niche === "todos" ? "todos" : list.find((x) => x.id === c.niche)?.name ?? c.niche}: {people.length} personas
            {(sent?.ok ?? 0) > 0 && ` · enviados ${sent?.ok}`}{(sent?.err ?? 0) > 0 && ` · errores ${sent?.err}`}</div></div>
      </div>
      <div className="grid g2">
        <form action={campaignAction} className="card">
          <input type="hidden" name="id" value={id} />
          <div className="field"><label>Nombre interno</label><input name="title" defaultValue={c.title} disabled={!editable} /></div>
          <div className="field"><label>Asunto</label><input name="subject" defaultValue={c.subject} disabled={!editable} /></div>
          <div className="field"><label>Para</label>
            <select name="niche" defaultValue={c.niche} disabled={!editable}><option value="todos">Todos</option>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          <div className="field"><label>Plantilla</label>
            <select name="template" defaultValue={c.template ?? ""} disabled={!editable}><option value="">Por defecto</option><option>Giraffora básica</option>{templates.map((t) => <option key={t.name}>{t.name}</option>)}</select></div>
          <div className="field"><label>Contenido (Markdown, usa {"{{nombre}}"})</label>
            <textarea name="body" defaultValue={c.body} style={{ minHeight: 380 }} disabled={!editable} /></div>
          {editable && (
            <div className="row">
              <Submit className="btn" name="action" value="save" pending="Guardando…">Guardar</Submit>
              <Submit className="btn" name="action" value="test" pending="Enviando prueba…">🧪 Enviarme una prueba</Submit>
              {c.status === "borrador"
                ? <Submit className="btn ok" name="action" value="approve" pending="Aprobando…">✓ Aprobar y enviar{c.send_at ? " en su fecha" : ""}</Submit>
                : <Submit className="btn" name="action" value="unapprove" pending="…">Volver a borrador</Submit>}
              <Submit className="btn danger sm" name="action" value="delete" pending="…">Eliminar</Submit>
            </div>
          )}
        </form>
        <section className="card">
          <h3>Vista previa</h3>
          <iframe srcDoc={preview} sandbox="" style={{ width: "100%", height: 640, border: "1px solid var(--line)", borderRadius: 10, background: "#fff" }} />
        </section>
      </div>
    </>
  );
}
