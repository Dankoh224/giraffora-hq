import { all } from "@/lib/db";
import { accounts } from "@/lib/mail";
import { Submit } from "@/components/Submit";
import { checkMailNow, emailDecision, sendDraft } from "../actions-mail";

const STARS = (n: number) => "★".repeat(n) + "☆".repeat(5 - n);
const GROUPS = [
  { t: "🔴 Importantes", min: 4, max: 5, open: true },
  { t: "🟡 Para esta semana", min: 3, max: 3, open: true },
  { t: "⚪ Informativos", min: 2, max: 2, open: false },
];

export default async function Correo({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams;
  const accs = accounts();
  const status = ver === "todo" ? "('nuevo','pendiente','respondido','ignorado','archivado')" : "('nuevo','pendiente')";
  const emails = await all(`SELECT * FROM emails WHERE status IN ${status} AND importance IS NOT NULL ORDER BY importance DESC, received_at DESC LIMIT 200`);
  const drafts = new Map((await all("SELECT * FROM outbox WHERE channel='email' AND status IN ('pending','approved') AND email_id IS NOT NULL")).map((o) => [o.email_id, o]));
  const unclassified = (await all("SELECT COUNT(*) AS n FROM emails WHERE importance IS NULL"))[0]?.n ?? 0;
  const low = (await all("SELECT COUNT(*) AS n FROM emails WHERE status='archivado' AND importance<=1"))[0]?.n ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Correo</h1>
          <div className="muted">Tu secretario lee {accs.length ? accs.map((a) => a.label).join(", ") : "tus cuentas"} cada 30 min y te lo ordena por importancia. Tú decides qué hacer.</div>
        </div>
        <div className="row">
          <a className="btn sm" href={ver === "todo" ? "/correo" : "/correo?ver=todo"}>{ver === "todo" ? "Solo pendientes" : "Ver todo"}</a>
          {!!accs.length && <form action={checkMailNow}><Submit className="btn" pending="Revisando…">↻ Revisar ahora</Submit></form>}
        </div>
      </div>

      {!accs.length && (
        <div className="notice">
          Aún no hay cuentas conectadas. En <code>.env.local</code> agrega, por cada cuenta, una <b>contraseña de aplicación</b> de Google
          (myaccount.google.com/apppasswords, requiere verificación en 2 pasos):<br />
          <code>MAIL_1_LABEL=personal</code> · <code>MAIL_1_USER=tucorreo@gmail.com</code> · <code>MAIL_1_PASS=xxxx xxxx xxxx xxxx</code> — y lo mismo con MAIL_2 y MAIL_3.
        </div>
      )}
      {unclassified > 0 && <p className="small muted">⏳ {unclassified} correos esperando clasificación.</p>}

      {GROUPS.map((g) => {
        const list = emails.filter((e) => e.importance >= g.min && e.importance <= g.max);
        if (!list.length) return null;
        return (
          <details key={g.t} open={g.open} style={{ marginBottom: 18 }}>
            <summary><h2 style={{ display: "inline" }}>{g.t} · {list.length}</h2></summary>
            <div className="stack" style={{ marginTop: 10 }}>
              {list.map((e) => {
                const d = drafts.get(e.id);
                return (
                  <div key={e.id} className="card">
                    <div className="row spread">
                      <div style={{ minWidth: 0 }}>
                        <b>{e.from_name || e.from_email}</b> <span className="small muted">{e.from_email}</span>
                        <div style={{ fontWeight: 600, marginTop: 2 }}>{e.subject}</div>
                      </div>
                      <div className="row small" style={{ gap: 6 }}>
                        <span className="badge">{e.account}</span><span className="badge b-review">{e.category}</span>
                        <span title="importancia" style={{ color: "var(--accent)" }}>{STARS(e.importance)}</span>
                      </div>
                    </div>
                    <p style={{ margin: "8px 0 4px" }}>{e.summary}</p>
                    <p className="small muted" style={{ margin: 0 }}>💡 {e.suggested_action} · {new Date(e.received_at).toLocaleString("es-CL")}</p>
                    <details style={{ marginTop: 8 }}><summary className="small muted">Ver correo completo</summary>
                      <pre style={{ whiteSpace: "pre-wrap", fontFamily: "inherit", fontSize: ".9rem" }}>{e.body}</pre></details>

                    {d ? (
                      <form action={sendDraft} style={{ marginTop: 10 }}>
                        <input type="hidden" name="outbox_id" value={d.id} />
                        <label>Respuesta para {d.recipient} {d.error && <span style={{ color: "var(--bad)" }}>· error: {d.error}</span>}</label>
                        <textarea name="body" defaultValue={d.body} style={{ minHeight: 160 }} />
                        <div className="row" style={{ marginTop: 6 }}>
                          <Submit className="btn ok" name="decision" value="send" pending="Enviando…">✉️ Enviar</Submit>
                          <Submit className="btn danger" name="decision" value="discard" pending="…">Descartar</Submit>
                        </div>
                      </form>
                    ) : ["nuevo", "pendiente"].includes(e.status) ? (
                      <form action={emailDecision} style={{ marginTop: 10 }}>
                        <input type="hidden" name="id" value={e.id} />
                        <textarea name="instruction" placeholder='Dile qué hacer: "respóndele que sí, el jueves a las 10" · "pídele la cotización por escrito" · "agradécele y dile que lo veo la próxima semana"' style={{ minHeight: 60 }} />
                        <div className="row" style={{ marginTop: 6 }}>
                          <Submit className="btn primary" name="decision" value="reply" pending="Redactando…">✍️ Redactar respuesta</Submit>
                          <Submit className="btn" name="decision" value="task" pending="…">📌 Convertir en tarea</Submit>
                          <Submit className="btn" name="decision" value="done" pending="…">✓ Listo</Submit>
                          <Submit className="btn danger" name="decision" value="ignore" pending="…">No tomar en cuenta</Submit>
                        </div>
                      </form>
                    ) : (
                      <form action={emailDecision} className="row small" style={{ marginTop: 8 }}>
                        <input type="hidden" name="id" value={e.id} />
                        <span className="badge">{e.status}</span>{e.instruction && <span className="muted">{e.instruction}</span>}
                        <button className="btn sm" name="decision" value="reopen">Reabrir</button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
      {!emails.length && !!accs.length && <div className="card muted">Bandeja al día. Nada pendiente.</div>}
      {low > 0 && <p className="small muted">🗑️ {low} promociones/spam archivadas automáticamente (ver con "Ver todo").</p>}
    </>
  );
}
