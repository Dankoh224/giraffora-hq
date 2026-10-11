import { setting } from "@/lib/db";
import { PROVIDERS, availableProviders } from "@/lib/llm";
import { saveCompany } from "../actions";

const CHECKS: [string, string, string][] = [
  ["DATABASE_URL", "Base de datos", "file: = tu PC · libsql:// = Turso (nube, para turnos con el PC apagado)"],
  ["TAVILY_API_KEY", "Búsqueda web mejorada", "Sin ella se usa DuckDuckGo (gratis, menos confiable)"],
  ["MERCADO_PUBLICO_TICKET", "Mercado Público", "Ticket gratis en api.mercadopublico.cl"],
  ["N8N_OUTBOX_WEBHOOK", "Envíos vía n8n", "WhatsApp, correo y llamadas aprobadas"],
  ["INGEST_SECRET", "Entrada de datos desde n8n", "Correo, calendario, WhatsApp, Notion → /api/ingest"],
  ["APP_PASSWORD", "Contraseña de la app", "Obligatoria si la publicas en internet"],
];

export default async function Ajustes() {
  const company = await setting("company");
  const brains = availableProviders();
  const dbUrl = process.env.DATABASE_URL || "file:data/empresa.db";

  return (
    <>
      <div className="page-head"><div><h1>Ajustes</h1><div className="muted">Lo que todos los agentes saben de Giraffora, y qué está conectado.</div></div></div>
      <div className="grid g2">
        <section className="card">
          <h2>🦒 Perfil de la empresa</h2>
          <p className="small muted">Todos los agentes leen esto antes de trabajar. Mientras más claro, mejor trabajan.</p>
          <form action={saveCompany}>
            <textarea name="company" defaultValue={company} style={{ minHeight: 280 }} />
            <button className="btn primary" style={{ marginTop: 8 }}>Guardar</button>
          </form>
        </section>
        <section className="card">
          <h2>🔌 Conexiones</h2>
          <ul className="list">
            <li className="row spread"><span><b>Cerebro principal</b><div className="small muted">Claude ({process.env.CLAUDE_MODEL || "sonnet"}) con tu plan Pro vía Claude Code; si se agota el cupo responde Gemini</div></span>
              <span className={`badge ${(process.env.BRAIN || "claude") === "claude" ? "b-done" : ""}`}>{(process.env.BRAIN || "claude") === "claude" ? "Claude" : "solo Gemini"}</span></li>
            <li className="row spread"><span><b>Cerebros de respaldo</b><div className="small muted">{Object.keys(PROVIDERS).join(" · ")} · por defecto {process.env.DEFAULT_MODEL || "gemini:gemini-flash-latest"}</div></span>
              <span className={`badge ${brains.length ? "b-done" : "b-changes"}`}>{brains.length ? brains.join(", ") : "ninguno"}</span></li>
            <li className="row spread"><span><b>Datawarehouse</b><div className="small muted">{dbUrl.startsWith("file:") ? "Archivo local en tu PC" : "Turso (nube)"}</div></span>
              <span className="badge b-done">{dbUrl.startsWith("file:") ? "local" : "nube"}</span></li>
            {CHECKS.slice(1).map(([k, t, d]) => (
              <li key={k} className="row spread"><span><b>{t}</b><div className="small muted">{d}</div></span>
                <span className={`badge ${process.env[k] ? "b-done" : ""}`}>{process.env[k] ? "conectado" : "pendiente"}</span></li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
