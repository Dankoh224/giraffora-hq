import Link from "next/link";
import { all, chileNow, get } from "@/lib/db";
import { Chat } from "@/components/Chat";
import { Submit } from "@/components/Submit";
import { hireAgentAction, saveDeal } from "../actions-sales";

const STAGES = [
  { id: "nuevo", label: "Nuevo" }, { id: "contactado", label: "Contactado" }, { id: "reunion", label: "Reunión" },
  { id: "propuesta", label: "Propuesta" }, { id: "negociacion", label: "Negociación" }, { id: "ganado", label: "Ganado" }, { id: "perdido", label: "Perdido" },
];
const clp = (n?: number | null) => (n ? `$${Number(n).toLocaleString("es-CL")}` : "");

function DealForm({ c }: { c?: any }) {
  return (
    <form action={saveDeal} className="stack" style={{ gap: 6, marginTop: 8 }}>
      {c && <input type="hidden" name="id" value={c.id} />}
      <div className="row"><input name="name" defaultValue={c?.name} placeholder="Nombre" required style={{ flex: 1 }} /><input name="company" defaultValue={c?.company ?? ""} placeholder="Organización" style={{ flex: 1 }} /></div>
      <div className="row"><input name="email" defaultValue={c?.email ?? ""} placeholder="Correo" style={{ flex: 1 }} /><input name="phone" defaultValue={c?.phone ?? ""} placeholder="Teléfono" style={{ flex: 1 }} /></div>
      <div className="row">
        <select name="stage" defaultValue={c?.stage ?? "nuevo"} style={{ flex: 1 }}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        <input name="deal_value" defaultValue={c?.deal_value ?? ""} placeholder="Valor $ CLP" style={{ flex: 1 }} />
      </div>
      <div className="row"><input name="next_action" defaultValue={c?.next_action ?? ""} placeholder="Próxima acción" style={{ flex: 2 }} /><input type="date" name="next_action_date" defaultValue={c?.next_action_date ?? ""} style={{ flex: 1 }} /></div>
      <input name="note" placeholder="Nota de esta interacción (opcional)" />
      <Submit className="btn sm primary" pending="Guardando…">Guardar</Submit>
    </form>
  );
}

export default async function CRM({ searchParams }: { searchParams: Promise<{ vista?: string }> }) {
  const { vista } = await searchParams;
  const { date } = chileNow();
  const catalina = await get("SELECT * FROM agents WHERE template_id='gestora-crm' AND status='active' LIMIT 1");
  const renata = await get("SELECT * FROM agents WHERE template_id='postventa' AND status='active' LIMIT 1");
  // Pipeline: prospectos y clientes (no los suscriptores sin interacción comercial)
  const deals = await all(`SELECT * FROM contacts WHERE coalesce(type,'')!='suscriptor' OR stage!='nuevo' OR deal_value IS NOT NULL OR next_action IS NOT NULL
    ORDER BY coalesce(next_action_date,'9999'), updated_at DESC LIMIT 500`);
  const open = deals.filter((d) => !["ganado", "perdido"].includes(d.stage));
  const total = open.reduce((a, d) => a + (Number(d.deal_value) || 0), 0);
  const due = open.filter((d) => d.next_action_date && d.next_action_date <= date);
  const won = deals.filter((d) => d.stage === "ganado");
  const msgs = catalina ? (await all("SELECT role, content, meta FROM messages WHERE agent_id=? ORDER BY created_at DESC LIMIT 12", [catalina.id])).reverse()
    .map((m) => ({ role: m.role, content: m.content, tools: m.meta ? JSON.parse(m.meta).tools : undefined })) : [];

  return (
    <>
      <div className="page-head">
        <div><h1>🗂️ CRM</h1>
          <div className="muted">{catalina ? `A cargo: ${catalina.emoji} ${catalina.name}, ${catalina.role}` : "Aún no hay Gestora de CRM"}{renata ? ` · Postventa: ${renata.emoji} ${renata.name}` : ""}</div></div>
        <div className="row">
          <Link className={`btn ${vista !== "postventa" ? "primary" : ""}`} href="/crm">Pipeline</Link>
          <Link className={`btn ${vista === "postventa" ? "primary" : ""}`} href="/crm?vista=postventa">Postventa y fidelización</Link>
        </div>
      </div>

      {!catalina && (
        <form action={hireAgentAction} className="notice row"><input type="hidden" name="template_id" value="gestora-crm" />
          Contrata a Catalina para que el CRM tenga dueña: revisa el pipeline cada mañana y prepara los seguimientos. <Submit className="btn sm primary" pending="Contratando…">Contratar a Catalina</Submit></form>
      )}

      <div className="stats">
        <div className="stat"><b>{open.length}</b><span>oportunidades abiertas</span></div>
        <div className="stat"><b>{clp(total) || "$0"}</b><span>valor del pipeline</span></div>
        <div className="stat"><b style={{ color: due.length ? "var(--bad)" : undefined }}>{due.length}</b><span>seguimientos para hoy o atrasados</span></div>
        <div className="stat"><b>{won.length}</b><span>clientes ganados</span></div>
      </div>

      {vista === "postventa" ? (
        <section className="card">
          <h2>💛 Clientes que ya compraron</h2>
          {!renata && (
            <form action={hireAgentAction} className="row small" style={{ marginBottom: 8 }}><input type="hidden" name="template_id" value="postventa" />
              <span className="muted">Renata hace seguimiento a los 7 y 30 días, pide testimonios y ofrece el siguiente curso.</span>
              <Submit className="btn sm" pending="Contratando…">Contratar a Renata</Submit></form>
          )}
          {won.length ? (
            <div className="md"><table><thead><tr><th>Cliente</th><th>Último contacto</th><th>Próxima acción</th><th>Historial</th></tr></thead>
              <tbody>{won.map((c) => (
                <tr key={c.id}><td><b>{c.name}</b><div className="small muted">{c.company} {c.email}</div></td>
                  <td className="small">{c.last_contact_at?.slice(0, 10) ?? "—"}</td>
                  <td className="small">{c.next_action ?? "—"} {c.next_action_date && <span className="muted">({c.next_action_date})</span>}</td>
                  <td className="small muted" style={{ whiteSpace: "pre-wrap" }}>{String(c.notes ?? "").split("\n").slice(-3).join("\n")}</td></tr>
              ))}</tbody></table></div>
          ) : <p className="muted">Cuando una oportunidad pase a "Ganado", aparece aquí para su postventa.</p>}
        </section>
      ) : (
        <div className="kanban" style={{ gridTemplateColumns: `repeat(${STAGES.length}, minmax(210px, 1fr))` }}>
          {STAGES.map((st) => {
            const list = deals.filter((d) => (d.stage ?? "nuevo") === st.id);
            const sum = list.reduce((a, d) => a + (Number(d.deal_value) || 0), 0);
            return (
              <div key={st.id} className="col">
                <h3>{st.label} · {list.length}{sum ? ` · ${clp(sum)}` : ""}</h3>
                {list.slice(0, 60).map((c) => (
                  <details key={c.id} className="tcard">
                    <summary style={{ listStyle: "none" }}>
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <div className="small muted">{c.company}{c.deal_value ? ` · ${clp(c.deal_value)}` : ""}</div>
                      {c.next_action && <div className="small" style={{ color: c.next_action_date && c.next_action_date <= date ? "var(--bad)" : "var(--muted)" }}>→ {c.next_action}{c.next_action_date ? ` (${c.next_action_date})` : ""}</div>}
                    </summary>
                    {c.notes && <pre className="small muted" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{String(c.notes).split("\n").slice(-4).join("\n")}</pre>}
                    <DealForm c={c} />
                  </details>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid g2" style={{ marginTop: 16 }}>
        <section className="card"><h2>＋ Nueva oportunidad</h2><DealForm /></section>
        {catalina && <section className="card"><h2>💬 Habla con {catalina.name}</h2><Chat agentId={catalina.id} agentName={catalina.name} initial={msgs} /></section>}
      </div>
    </>
  );
}
