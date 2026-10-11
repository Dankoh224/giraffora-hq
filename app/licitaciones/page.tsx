import Link from "next/link";
import { all, chileNow, get } from "@/lib/db";
import { SpacesNav } from "@/components/SpacesNav";
import { Submit } from "@/components/Submit";
import { Uploader } from "@/components/Uploader";
import { filesAvailable } from "@/lib/files";
import { syncTenderDocs, tenderFolder } from "@/lib/tenders";
import { addTender, reviewTender, searchTendersNow, tenderAction } from "../actions-sales";

const COMPLY: Record<string, [string, string]> = { si: ["✅ Cumplimos", "b-done"], parcial: ["⚠️ Parcial", "b-review"], no: ["⛔ No cumplimos", "b-changes"] };
const STATUS: Record<string, string> = { nueva: "nueva", preparando_oferta: "preparando oferta", postulada: "postulada", ganada: "ganada 🎉", perdida: "perdida", descartada: "descartada" };

export default async function Licitaciones({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver = "postulables" } = await searchParams;
  const { date } = chileNow();
  const where = ver === "descartadas" ? "status='descartada' OR can_comply='no'" : ver === "todas" ? "1=1" : "can_comply IN ('si','parcial') AND status!='descartada'";
  const list = await all(`SELECT * FROM tenders WHERE ${where} ORDER BY CASE status WHEN 'nueva' THEN 0 WHEN 'preparando_oferta' THEN 1 ELSE 2 END, coalesce(close_date,'9999') LIMIT 200`);
  const gabriela = await get("SELECT * FROM agents WHERE template_id='cazador-licitaciones' AND status='active' LIMIT 1");
  const olivia = await get("SELECT * FROM agents WHERE template_id='redactora-ofertas' AND status='active' LIMIT 1");
  const local = filesAvailable();
  if (local) await syncTenderDocs();
  const docs = await all("SELECT tender_id, name, size, length(text) AS chars FROM tender_docs ORDER BY name");
  const folders: Record<string, string> = {};
  if (local) for (const t of list) folders[t.id] = await tenderFolder(t.id);
  const days = (d?: string) => (d ? Math.ceil((new Date(d.slice(0, 10)).getTime() - new Date(date).getTime()) / 864e5) : null);

  return (
    <>
      <SpacesNav active="comercial" />
      <div className="page-head">
        <div><h1>🔎 Licitaciones</h1>
          <div className="muted">Busca: {gabriela ? `${gabriela.emoji} ${gabriela.name}` : "Gabriela (se contrata al buscar)"} · Ofertas: {olivia ? `${olivia.emoji} ${olivia.name}` : "Olivia (se contrata al preparar una oferta)"}.
            Solo pasan las que podemos cumplir según sus bases.</div></div>
        <form action={searchTendersNow}><Submit pending="Gabriela está buscando…">🔎 Buscar ahora</Submit></form>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        {[["postulables", "Podemos postular"], ["todas", "Todas"], ["descartadas", "Descartadas"]].map(([k, l]) =>
          <Link key={k} href={`/licitaciones?ver=${k}`} className={`btn sm ${ver === k ? "primary" : ""}`}>{l}</Link>)}
        <Link href="/archivos?p=Plantillas%2FWord" className="btn sm">📘 Plantillas Word</Link>
      </div>

      <details className="card" style={{ marginBottom: 12 }}>
        <summary><b>＋ Agregar una licitación a mano</b> <span className="small muted">(si la encontraste tú)</span></summary>
        <form action={addTender} className="stack" style={{ gap: 6, marginTop: 8 }}>
          <div className="row"><input name="code" placeholder="Código (ej: 1234-56-LE26)" style={{ flex: 1 }} /><input name="name" placeholder="Nombre" required style={{ flex: 2 }} /></div>
          <div className="row"><input name="buyer" placeholder="Organismo" style={{ flex: 1 }} /><input name="close_date" type="date" style={{ flex: 1 }} /><input name="url" placeholder="Link a la ficha" style={{ flex: 2 }} /></div>
          <Submit className="btn sm primary" pending="Creando…">Agregar y crear su carpeta</Submit>
        </form>
      </details>

      <div className="stack">
        {list.map((t) => {
          const d = days(t.close_date);
          const [label, cls] = COMPLY[t.can_comply] ?? ["?", ""];
          return (
            <div key={t.id} className="card">
              <div className="row spread">
                <div style={{ minWidth: 0 }}>
                  <b>{t.name}</b>
                  <div className="small muted">{t.code} · {t.buyer}{t.amount ? ` · ${t.amount}` : ""}{t.url && <> · <a href={t.url} target="_blank" rel="noreferrer">ver ficha</a></>}</div>
                </div>
                <div className="row small" style={{ gap: 6 }}>
                  <span className={`badge ${cls}`}>{label}</span>
                  {t.fit && <span style={{ color: "var(--accent)" }}>{"★".repeat(t.fit)}{"☆".repeat(5 - t.fit)}</span>}
                  {d !== null && <span className={`badge ${d <= 5 ? "b-changes" : ""}`}>{d < 0 ? "cerrada" : `cierra en ${d} días`}</span>}
                  <span className="badge">{STATUS[t.status] ?? t.status}</span>
                </div>
              </div>
              <details style={{ marginTop: 6 }}><summary className="small muted">Requisitos y análisis</summary>
                <p className="small" style={{ whiteSpace: "pre-wrap" }}>{t.requirements}</p>
                {t.gaps && <p className="small"><b>Brechas:</b> {t.gaps}</p>}
                {t.notes && <p className="small"><b>Estrategia:</b> {t.notes}</p>}
              </details>
              <details style={{ marginTop: 6 }} open={!docs.some((d) => d.tender_id === t.id) && t.status === "nueva"}>
                <summary className="small"><b>📎 Bases y anexos ({docs.filter((d) => d.tender_id === t.id).length})</b></summary>
                <ul className="list small">{docs.filter((d) => d.tender_id === t.id).map((d) => (
                  <li key={d.name}>{local ? <Link href={`/archivos?p=${encodeURIComponent(`${folders[t.id]}/${d.name}`)}`}>📄 {d.name}</Link> : <>📄 {d.name}</>}
                    <span className="muted"> · {Math.round((d.size ?? 0) / 1024)} KB · {d.chars ? "texto leído ✓" : "sin texto legible"}</span></li>
                ))}</ul>
                {local ? <Uploader dir={folders[t.id]} label="Subir bases, anexos y formularios descargados" />
                  : <p className="small muted">Los documentos se suben desde el PC.</p>}
                {docs.some((d) => d.tender_id === t.id) && (
                  <form action={reviewTender} style={{ marginTop: 8 }}><input type="hidden" name="id" value={t.id} />
                    <Submit className="btn sm" pending="Gabriela está leyendo…">🔍 Revisar requisitos con estos documentos</Submit></form>
                )}
              </details>
              <form action={tenderAction} className="row" style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={t.id} />
                {t.offer_task_id
                  ? <Link className="btn sm primary" href={`/tareas/${t.offer_task_id}`}>📑 Ver oferta</Link>
                  : t.can_comply !== "no" && <>
                    <input name="instruction" placeholder="Indicaciones para la oferta (opcional)" style={{ flex: 1, minWidth: 200 }} />
                    <Submit className="btn sm primary" name="action" value="offer" pending="Olivia está redactando…">📑 Preparar oferta</Submit></>}
                {t.status === "preparando_oferta" && <Submit className="btn sm" name="action" value="applied" pending="…">Marcar postulada</Submit>}
                {t.status === "postulada" && <><Submit className="btn sm ok" name="action" value="won" pending="…">Ganada</Submit><Submit className="btn sm" name="action" value="lost" pending="…">Perdida</Submit></>}
                {t.status === "descartada" ? <Submit className="btn sm" name="action" value="reopen" pending="…">Reabrir</Submit>
                  : <Submit className="btn sm danger" name="action" value="discard" pending="…">Descartar</Submit>}
              </form>
            </div>
          );
        })}
        {!list.length && <div className="card muted">Aún no hay licitaciones aquí. Presiona "Buscar ahora" o espera la búsqueda diaria de las 2:00.</div>}
      </div>
    </>
  );
}
