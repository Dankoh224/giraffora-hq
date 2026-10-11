// Habilidades (herramientas) que un agente puede tener. Cada agente solo recibe las de su lista
// "skills" + ask_ceo. Nada sale al exterior sin aprobación: los mensajes quedan en la Bandeja.
import { all, get, newId, now, run } from "./db";
import type { ToolDef } from "./llm";
import { createTask, getAgent, hireCustom, hireFromTemplate, type Agent } from "./org";
import { TEMPLATES } from "./templates";

export type ToolCtx = { agent: Agent; taskId?: string; questions: string[] };
type Tool = { def: ToolDef["function"]; label: string; run: (args: any, ctx: ToolCtx) => Promise<string> };

const obj = (properties: Record<string, object>, required: string[] = []) => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) GirafforaAgent/0.1" };
// Ninguna herramienta puede colgar un turno: todas las llamadas externas tienen límite de tiempo.
const fetch = (url: string, init: RequestInit = {}) => globalThis.fetch(url, { signal: AbortSignal.timeout(25000), ...init });

export const TOOLS: Record<string, Tool> = {
  web_search: {
    label: "Buscar en internet",
    def: { name: "web_search", description: "Busca en internet. Devuelve títulos, URLs y extractos.", parameters: obj({ query: str("Consulta de búsqueda") }, ["query"]) },
    async run({ query }) {
      if (process.env.TAVILY_API_KEY) {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.TAVILY_API_KEY}` },
          body: JSON.stringify({ query, max_results: 6 }),
        });
        const d = await r.json();
        return (d.results ?? []).map((x: any) => `- ${x.title}\n  ${x.url}\n  ${String(x.content).slice(0, 300)}`).join("\n") || "Sin resultados";
      }
      const html = await (await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { headers: UA })).text();
      const out: string[] = [];
      const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let m;
      while ((m = re.exec(html)) && out.length < 8) {
        let url = m[1];
        const u = url.match(/uddg=([^&]+)/);
        if (u) url = decodeURIComponent(u[1]);
        out.push(`- ${strip(m[2])}\n  ${url}\n  ${strip(m[3])}`);
      }
      return out.join("\n") || "Sin resultados (el buscador gratuito pudo bloquear la consulta; configura TAVILY_API_KEY).";
    },
  },
  read_url: {
    label: "Leer páginas web",
    def: { name: "read_url", description: "Lee el contenido de una página web como texto.", parameters: obj({ url: str("URL completa") }, ["url"]) },
    async run({ url }) {
      const r = await fetch(`https://r.jina.ai/${url}`, { headers: UA }).catch(() => null);
      if (r?.ok) return (await r.text()).slice(0, 12000);
      const direct = await fetch(url, { headers: UA });
      return strip(await direct.text()).slice(0, 12000);
    },
  },
  generate_image: {
    label: "Generar imágenes",
    def: {
      name: "generate_image",
      description: "Genera una imagen a partir de un prompt en inglés (sin texto dentro de la imagen). Devuelve Markdown con la imagen para incluir en tu entrega.",
      parameters: obj({ prompt: str("Descripción visual detallada en inglés"), formato: { type: "string", enum: ["vertical", "cuadrado", "horizontal"] } }, ["prompt"]),
    },
    async run({ prompt, formato }) {
      const [w, h] = formato === "cuadrado" ? [1080, 1080] : formato === "horizontal" ? [1600, 900] : [1080, 1350];
      const seed = Math.floor(Math.random() * 1e6);
      const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=${w}&height=${h}&seed=${seed}&nologo=true`;
      return `Imagen generada. Inclúyela así en tu entrega:\n![${prompt.slice(0, 60)}](${url})`;
    },
  },
  mercado_publico: {
    label: "Buscar en Mercado Público",
    def: {
      name: "mercado_publico",
      description: "Busca licitaciones activas en Mercado Público (Chile) cuyo nombre contenga alguna palabra clave.",
      parameters: obj({ palabras: str("Palabras clave separadas por coma, ej: capacitación, inteligencia artificial") }, ["palabras"]),
    },
    async run({ palabras }) {
      const ticket = process.env.MERCADO_PUBLICO_TICKET;
      if (!ticket) return "No hay MERCADO_PUBLICO_TICKET configurado (se pide gratis en api.mercadopublico.cl). Usa web_search con 'site:mercadopublico.cl' mientras tanto.";
      const r = await fetch(`https://api.mercadopublico.cl/servicios/v1/publico/licitaciones.json?estado=activas&ticket=${ticket}`);
      const d = await r.json();
      const keys = String(palabras).toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
      const hits = (d.Listado ?? []).filter((l: any) => keys.some((k) => String(l.Nombre).toLowerCase().includes(k)));
      return hits.slice(0, 30).map((l: any) =>
        `- ${l.CodigoExterno} | ${l.Nombre} | cierre: ${l.FechaCierre ?? "?"} | https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${l.CodigoExterno}`,
      ).join("\n") || `Sin licitaciones activas con: ${keys.join(", ")} (revisadas ${d.Cantidad ?? 0}).`;
    },
  },
  query_data: {
    label: "Consultar el datawarehouse",
    def: {
      name: "query_data",
      description: "Consulta SQL de solo lectura (SELECT) al datawarehouse. Tablas: events(source,kind,from_name,from_contact,category,title,body,occurred_at), contacts(name,type,company,email,phone,linkedin,stage,notes,niches,subscribed,source,deal_value,next_action,next_action_date,last_contact_at,updated_at), tenders(code,name,buyer,amount,close_date,url,requirements,can_comply,fit,gaps,status), emails(account,from_name,from_email,subject,summary,importance,category,status,received_at), campaigns(title,niche,subject,status,sent_count,template), email_templates(name), tasks(title,status,agent_id,priority,updated_at), deliverables(task_id,version,content), todos(text,due,done), outbox(channel,recipient,subject,status), agents(id,name,role,area_id).",
      parameters: obj({ sql: str("Consulta SELECT") }, ["sql"]),
    },
    async run({ sql }) {
      const q = String(sql).trim().replace(/;+\s*$/, "");
      if (!/^(select|with)\b/i.test(q) || q.includes(";")) return "Solo se permite una consulta SELECT.";
      const rows = await all(/\blimit\b/i.test(q) ? q : `${q} LIMIT 100`);
      return JSON.stringify(rows).slice(0, 12000);
    },
  },
  upsert_contact: {
    label: "Actualizar CRM",
    def: {
      name: "upsert_contact",
      description: "Crea o actualiza un contacto en el CRM (busca por email o nombre).",
      parameters: obj({
        name: str("Nombre completo"), type: str("cliente | estudiante | prospecto | aliado | prensa | proveedor | amigo"),
        company: str("Organización"), email: str("Correo"), phone: str("Teléfono"), linkedin: str("URL LinkedIn"),
        stage: str("nuevo | contactado | reunion | propuesta | negociacion | ganado | perdido"), notes: str("Nota de esta interacción (se agrega al historial)"),
        deal_value: { type: "integer", description: "Valor estimado del negocio en CLP" }, next_action: str("Próxima acción concreta"),
        next_action_date: str("Fecha de la próxima acción (AAAA-MM-DD)"), contacted: { type: "boolean", description: "true si hubo contacto hoy" },
      }, ["name"]),
    },
    async run(a) {
      const found = await get<{ id: string; notes: string }>(
        "SELECT id, notes FROM contacts WHERE (email IS NOT NULL AND email=?) OR lower(name)=lower(?)", [a.email ?? "", a.name]);
      if (found) {
        await run(`UPDATE contacts SET type=coalesce(?,type), company=coalesce(?,company), email=coalesce(?,email), phone=coalesce(?,phone),
          linkedin=coalesce(?,linkedin), stage=coalesce(?,stage), notes=?, deal_value=coalesce(?,deal_value), next_action=coalesce(?,next_action),
          next_action_date=coalesce(?,next_action_date), last_contact_at=CASE WHEN ? THEN ? ELSE last_contact_at END, updated_at=? WHERE id=?`,
          [a.type ?? null, a.company ?? null, a.email ?? null, a.phone ?? null, a.linkedin ?? null, a.stage ?? null,
           [found.notes, a.notes && `[${now().slice(0, 10)}] ${a.notes}`].filter(Boolean).join("\n"), a.deal_value ?? null, a.next_action ?? null,
           a.next_action_date ?? null, a.contacted ? 1 : 0, now(), now(), found.id]);
        return `Contacto actualizado (${found.id})`;
      }
      const id = newId();
      await run("INSERT INTO contacts(id,name,type,company,email,phone,linkedin,stage,notes,deal_value,next_action,next_action_date,last_contact_at,token,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [id, a.name, a.type ?? null, a.company ?? null, a.email ?? null, a.phone ?? null, a.linkedin ?? null, a.stage ?? "nuevo",
         a.notes ? `[${now().slice(0, 10)}] ${a.notes}` : null, a.deal_value ?? null, a.next_action ?? null, a.next_action_date ?? null, a.contacted ? now() : null, newId() + newId(), now(), now()]);
      return `Contacto creado (${id})`;
    },
  },
  draft_message: {
    label: "Redactar mensajes (requieren tu aprobación)",
    def: {
      name: "draft_message",
      description: "Deja un mensaje en la Bandeja de salida para que el CEO lo apruebe antes de enviarse.",
      parameters: obj({
        channel: { type: "string", enum: ["email", "whatsapp", "linkedin", "call"] },
        recipient: str("Correo, teléfono o perfil del destinatario"), subject: str("Asunto (email) u objetivo (llamada)"), body: str("Texto del mensaje o guion"),
      }, ["channel", "recipient", "body"]),
    },
    async run(a, ctx) {
      await run("INSERT INTO outbox(id,agent_id,task_id,channel,recipient,subject,body,created_at) VALUES(?,?,?,?,?,?,?,?)",
        [newId(), ctx.agent.id, ctx.taskId ?? null, a.channel, a.recipient, a.subject ?? "", a.body, now()]);
      return "Borrador guardado en la Bandeja. Se enviará solo si el CEO lo aprueba.";
    },
  },
  notify_ceo: {
    label: "Avisar al CEO (en la app)",
    def: {
      name: "notify_ceo",
      description: "Deja un aviso al CEO en sus prioridades de la app (ej: un cliente pide que lo llame, hay un problema que corregir). Úsalo para lo que requiera su atención.",
      parameters: obj({ message: str("Mensaje breve y accionable"), priority: { type: "integer", description: "1 urgente, 2 importante, 3 informativo" } }, ["message"]),
    },
    async run({ message, priority }, ctx) {
      await run("INSERT INTO notices(id,agent_id,priority,title,link,created_at) VALUES(?,?,?,?,?,?)",
        [newId(), ctx.agent.id, Math.min(3, Math.max(1, Number(priority) || 2)), message, ctx.taskId ? `/tareas/${ctx.taskId}` : null, now()]);
      return "Aviso dejado en las prioridades del CEO.";
    },
  },
  create_campaign: {
    label: "Preparar envíos masivos (newsletter)",
    def: {
      name: "create_campaign",
      description: "Crea un correo masivo para los suscriptores (queda como borrador; el CEO lo aprueba antes de enviarse). Usa {{nombre}} para personalizar.",
      parameters: obj({
        title: str("Nombre interno de la campaña"), subject: str("Asunto del correo"),
        body: str("Cuerpo en Markdown, empezando con un saludo que use {{nombre}}"),
        niche: str("A quién: todos | educacion | derecho | terapeutas | empresa"),
        template: str("Nombre de la plantilla de Giraffora a usar (opcional; ver tabla email_templates)"),
      }, ["title", "subject", "body"]),
    },
    async run(a, ctx) {
      const { createCampaign } = await import("./newsletter");
      const { audience } = await import("./contacts");
      const niche = a.niche || "todos";
      const id = await createCampaign({ title: a.title, subject: a.subject, body: a.body, niche, template: a.template ?? null, agent_id: ctx.agent.id, task_id: ctx.taskId ?? null });
      return `Campaña ${id} creada como borrador para "${niche}" (${(await audience(niche)).length} destinatarios). El CEO la revisa y aprueba en Newsletter.`;
    },
  },
  save_tender: {
    label: "Guardar licitaciones evaluadas",
    def: {
      name: "save_tender",
      description: "Guarda (o actualiza) una licitación evaluada, con su análisis de requisitos y si Giraffora puede cumplirlos.",
      parameters: obj({
        code: str("Código de la licitación (ej: 1234-56-LE26)"), name: str("Nombre"), buyer: str("Organismo comprador"),
        amount: str("Monto estimado"), close_date: str("Fecha de cierre (AAAA-MM-DD HH:MM)"), url: str("Link a la ficha"),
        requirements: str("Resumen de requisitos clave (experiencia, certificaciones, garantías, equipo, plazos, documentos)"),
        can_comply: { type: "string", enum: ["si", "parcial", "no"] }, fit: { type: "integer", description: "Calce con Giraffora 1–5" },
        gaps: str("Brechas o razones (si es parcial o no)"), notes: str("Notas / estrategia sugerida"),
      }, ["code", "name", "can_comply"]),
    },
    async run(a) {
      const ex = await get("SELECT id, status FROM tenders WHERE code=?", [a.code]);
      const vals = [a.name, a.buyer ?? null, a.amount ?? null, a.close_date ?? null, a.url ?? null, a.requirements ?? null, a.can_comply, a.fit ?? null, a.gaps ?? null, a.notes ?? null];
      if (ex) {
        await run("UPDATE tenders SET name=?, buyer=?, amount=?, close_date=?, url=?, requirements=?, can_comply=?, fit=?, gaps=?, notes=?, updated_at=? WHERE id=?", [...vals, now(), ex.id]);
        return `Licitación ${a.code} actualizada.`;
      }
      await run("INSERT INTO tenders(id,code,name,buyer,amount,close_date,url,requirements,can_comply,fit,gaps,notes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [newId(), a.code, ...vals, a.can_comply === "no" ? "descartada" : "nueva", now(), now()]);
      return `Licitación ${a.code} guardada (${a.can_comply}).`;
    },
  },
  tender_documents: {
    label: "Leer bases y anexos de licitaciones",
    def: {
      name: "tender_documents",
      description: "Lee los documentos (bases técnicas/administrativas, anexos, formularios) que el CEO subió a la carpeta de una licitación. Sin file devuelve la lista y un extracto de cada uno; con file devuelve ese documento completo.",
      parameters: obj({ code: str("Código de la licitación"), file: str("Nombre exacto del documento (opcional)"), offset: { type: "integer", description: "Desde qué carácter seguir leyendo un documento largo" } }, ["code"]),
    },
    async run({ code, file, offset = 0 }) {
      const t = await get("SELECT id, folder FROM tenders WHERE code=?", [code]);
      if (!t) return "No existe esa licitación. Guárdala primero con save_tender.";
      const docs = await all("SELECT name, size, text FROM tender_docs WHERE tender_id=? ORDER BY name", [t.id]);
      if (!docs.length) return `Aún no hay documentos en Archivos/${t.folder ?? "Licitaciones/…"}. Pide al CEO (ask_ceo) que descargue las bases y anexos de Mercado Público y los suba ahí.`;
      if (file) {
        const d = docs.find((x) => x.name === file);
        if (!d) return `No existe "${file}". Documentos: ${docs.map((x) => x.name).join(", ")}`;
        const chunk = String(d.text ?? "(sin texto legible)").slice(offset, offset + 40000);
        const more = (d.text?.length ?? 0) > offset + 40000 ? `\n\n[continúa: usa offset=${offset + 40000}]` : "";
        return chunk + more;
      }
      return docs.map((d) => `### ${d.name} (${Math.round((d.size ?? 0) / 1024)} KB, ${d.text?.length ?? 0} caracteres)\n${String(d.text ?? "(sin texto legible: imagen o formato no soportado)").slice(0, 4000)}`).join("\n\n");
    },
  },
  manage_subscriber: {
    label: "Dar de alta / baja suscriptores",
    def: {
      name: "manage_subscriber",
      description: "Agrega un suscriptor al newsletter (o actualiza su nicho) o lo da de baja. El Excel del nicho se actualiza solo.",
      parameters: obj({
        action: { type: "string", enum: ["alta", "baja"] }, email: str("Correo"), name: str("Nombre"),
        niche: str("Nicho: educacion | derecho | terapeutas | empresa"), company: str("Organización"), source: str("De dónde viene (ej: formulario web, charla)"),
      }, ["action", "email"]),
    },
    async run(a) {
      const email = String(a.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return "Correo inválido.";
      const ex = await get("SELECT * FROM contacts WHERE lower(email)=?", [email]);
      if (a.action === "baja") {
        if (!ex) return "Ese correo no está en la base.";
        await run("UPDATE contacts SET subscribed=0, unsubscribed_at=? WHERE id=?", [now(), ex.id]);
        return `${email} dado de baja.`;
      }
      if (ex) {
        if (!ex.subscribed) return `${email} se dio de baja antes; no se puede volver a suscribir sin su consentimiento explícito.`;
        const niches = [...new Set([...(ex.niches ?? "").split(","), a.niche].filter(Boolean))].join(",");
        await run("UPDATE contacts SET niches=?, updated_at=? WHERE id=?", [niches || null, now(), ex.id]);
        return `${email} ya existía; nichos: ${niches}.`;
      }
      await run("INSERT INTO contacts(id,name,type,company,email,stage,niches,subscribed,source,token,created_at,updated_at) VALUES(?,?,'suscriptor',?,?,'nuevo',?,1,?,?,?,?)",
        [newId(), a.name || email.split("@")[0], a.company ?? null, email, a.niche ?? null, a.source ?? "agente", newId() + newId(), now(), now()]);
      return `${email} suscrito${a.niche ? ` a ${a.niche}` : ""}.`;
    },
  },
  delegate_task: {
    label: "Delegar tareas a otros agentes",
    def: {
      name: "delegate_task",
      description: "Crea una tarea para otro agente del equipo (usa su id del listado de equipo).",
      parameters: obj({
        agent_id: str("id del agente"), title: str("Título corto"),
        brief: str("Brief: objetivo, contexto, formato de entrega y criterio de listo"), priority: { type: "integer", description: "1 alta, 2 normal, 3 baja" },
      }, ["agent_id", "title", "brief"]),
    },
    async run(a, ctx) {
      const target = await getAgent(a.agent_id);
      if (!target) return `No existe el agente ${a.agent_id}. Revisa el listado de equipo o contrata uno.`;
      const id = await createTask({ title: a.title, brief: a.brief, agent_id: target.id, parent_id: ctx.taskId, priority: a.priority ?? 2, created_by: ctx.agent.id });
      return `Tarea ${id} asignada a ${target.name} (${target.role}). Se trabajará en el próximo turno.`;
    },
  },
  hire_agent: {
    label: "Contratar nuevos agentes",
    def: {
      name: "hire_agent",
      description: `Contrata un agente. Usa template_id si existe una plantilla adecuada; si no, define un puesto a medida. Plantillas: ${TEMPLATES.map((t) => `${t.id} (${t.role})`).join(", ")}`,
      parameters: obj({
        template_id: str("id de plantilla (opcional)"), area: str("Área (para puestos a medida)"), name: str("Nombre de pila"),
        role: str("Cargo"), rank: { type: "string", enum: ["director", "senior", "junior"] },
        prompt: str("Instrucciones detalladas de su especialidad (puesto a medida)"),
        skills: { type: "array", items: { type: "string" }, description: "Habilidades: web_search, read_url, generate_image, mercado_publico, query_data, upsert_contact, draft_message, notify_ceo, delegate_task" },
      }),
    },
    async run(a) {
      const agent = a.template_id
        ? await hireFromTemplate(a.template_id, a.name)
        : await hireCustom({ area: a.area || "General", name: a.name || "Nuevo agente", role: a.role || "Especialista", rank: a.rank, skills: a.skills, prompt: a.prompt || a.role });
      return `Contratado: ${agent.name}, ${agent.role} (id: ${agent.id}).`;
    },
  },
  ask_ceo: {
    label: "Preguntar al CEO",
    def: { name: "ask_ceo", description: "Registra una pregunta para el CEO cuando falta información clave. Sigue trabajando con supuestos razonables.", parameters: obj({ question: str("Pregunta concreta") }, ["question"]) },
    async run({ question }, ctx) {
      ctx.questions.push(question);
      return "Pregunta registrada; el CEO la verá al revisar tu entrega. Continúa con supuestos razonables y explícitalos.";
    },
  },
};

export const SKILL_NAMES = Object.keys(TOOLS).filter((k) => k !== "ask_ceo");

export function toolsFor(agent: Agent): ToolDef[] {
  const skills: string[] = JSON.parse(agent.skills || "[]");
  return [...new Set([...skills, "ask_ceo"])].filter((s) => TOOLS[s]).map((s) => ({ type: "function", function: TOOLS[s].def }));
}

export async function executeTool(name: string, args: any, ctx: ToolCtx) {
  const tool = TOOLS[name];
  const skills: string[] = JSON.parse(ctx.agent.skills || "[]");
  if (!tool || (name !== "ask_ceo" && !skills.includes(name))) return `No tienes la habilidad "${name}".`;
  return tool.run(args, ctx);
}


function strip(html: string) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}
