// Motor de trabajo: cómo piensa y entrega cada agente, el ciclo de revisión con el CEO,
// el chat, las rutinas diarias y el turno de noche que arma el brief matinal.
import { all, chileNow, get, newId, now, run, setSetting, setting } from "./db";
import { chat, type Msg } from "./llm";
import { activeAgents, createTask, getAgent, type Agent, type Area } from "./org";
import { executeTool, toolsFor, type ToolCtx } from "./tools";

type LogEntry = { t: "llm"; model: string } | { t: "tool"; name: string; args: unknown; out: string };

export async function systemPrompt(agent: Agent) {
  const area = await get<Area>("SELECT * FROM areas WHERE id=?", [agent.area_id]);
  const company = await setting("company");
  const team = (await activeAgents()).map((a) => `- ${a.id}: ${a.name}, ${a.role} [${a.rank}] — ${a.area_name}`).join("\n");
  const { date } = chileNow();
  return `Eres ${agent.name}, ${agent.role} (rango ${agent.rank}) del área "${area?.name}" de Giraffora, una empresa operada por un equipo de agentes de IA y dirigida por un CEO humano que revisa el trabajo cada mañana. Hoy es ${date} (Chile).

## Sobre Giraffora
${company}

## Tu especialidad
${agent.system_prompt}

## Equipo actual (id: nombre, cargo)
${team}

## Reglas
- Escribe en español de Chile, claro, concreto y accionable.
- Entrega siempre un resultado terminado (documento, borrador, tabla, plan, código), nunca solo promesas.
- No inventes datos ni fuentes. Si investigas, usa tus herramientas y cita las URLs.
- Nada sale al exterior por tu cuenta: los mensajes van como borradores para aprobación del CEO.
- Si falta información clave, usa ask_ceo y continúa con supuestos explícitos.
- Si algo es de otra especialidad y puedes delegar, delega en vez de hacerlo mal.
- Tu respuesta final es el entregable en Markdown: empieza con un título "# ..." y termina con "## Próximos pasos".`;
}

export async function runLoop(agent: Agent, messages: Msg[], ctx: ToolCtx, maxSteps = 8) {
  const log: LogEntry[] = [];
  // Cerebro principal: Claude (tu plan Pro). Si no está disponible o se agotó el cupo, sigue con Gemini.
  const { claudeEnabled, claudeThink } = await import("./claude");
  if (claudeEnabled()) {
    const system = String(messages.find((m) => m.role === "system")?.content ?? "");
    const turns = messages.filter((m) => m.role === "user" || m.role === "assistant") as { role: string; content: string }[];
    const prompt = turns.length === 1 ? turns[0].content
      : `${turns.slice(0, -1).map((m) => `${m.role === "user" ? "CEO" : agent.name}: ${m.content}`).join("\n\n")}\n\n---\nÚltimo mensaje del CEO (respóndelo):\n${turns.at(-1)!.content}`;
    try {
      const r = await claudeThink({ agent, system, prompt, taskId: ctx.taskId });
      ctx.questions.push(...r.questions);
      return { text: r.text, log: [{ t: "llm", model: r.model } as LogEntry] };
    } catch (e: any) {
      log.push({ t: "tool", name: "claude-no-disponible", args: {}, out: String(e.message).slice(0, 300) });
    }
  }
  const tools = toolsFor(agent);
  for (let step = 0; step < maxSteps; step++) {
    const res = await chat(messages, tools, agent.model);
    log.push({ t: "llm", model: res.model });
    messages.push(res.message);
    const calls = res.message.role === "assistant" ? res.message.tool_calls ?? [] : [];
    if (!calls.length) return { text: (res.message.content as string) ?? "", log };
    for (const call of calls) {
      let args: any = {};
      try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* argumentos inválidos */ }
      let out: string;
      try { out = await executeTool(call.function.name, args, ctx); } catch (e: any) { out = `ERROR: ${e.message}`; }
      log.push({ t: "tool", name: call.function.name, args, out: out.slice(0, 600) });
      messages.push({ role: "tool", tool_call_id: call.id, content: out.slice(0, 12000) });
    }
  }
  messages.push({ role: "user", content: "Se acabaron los pasos de herramientas. Entrega ahora tu resultado final en Markdown con lo que tienes." });
  const res = await chat(messages, undefined, agent.model);
  log.push({ t: "llm", model: res.model });
  return { text: (res.message.content as string) ?? "", log };
}

// Arma el encargo completo: brief, trabajo delegado, versión anterior y comentarios del CEO.
export async function buildTaskPrompt(task: any) {
  const prev = await get("SELECT * FROM deliverables WHERE task_id=? ORDER BY version DESC LIMIT 1", [task.id]);
  const feedback = await all("SELECT * FROM feedback WHERE task_id=? ORDER BY created_at", [task.id]);
  const subtasks = await all(
    `SELECT t.title, t.status, a.name AS agent, (SELECT content FROM deliverables d WHERE d.task_id=t.id ORDER BY version DESC LIMIT 1) AS content
     FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.parent_id=?`, [task.id]);

  let prompt = `# Tarea: ${task.title}\n\n${task.brief || ""}`;
  if (subtasks.length)
    prompt += `\n\n## Trabajo delegado\n${subtasks.map((s) => `### ${s.title} — ${s.agent} (${s.status})\n${(s.content ?? "aún sin entrega").slice(0, 3000)}`).join("\n\n")}`;
  if (prev) prompt += `\n\n## Versión anterior (v${prev.version}${prev.author === "ceo" ? ", editada a mano por el CEO: respeta sus cambios" : ""})\n${prev.content}`;
  if (feedback.length) prompt += `\n\n## Comentarios del CEO\n${feedback.map((f) => `- (${f.decision}) ${f.body}`).join("\n")}`;
  prompt += prev
    ? "\n\nEntrega una NUEVA versión completa aplicando todos los comentarios del CEO."
    : "\n\nRealiza la tarea y entrega el resultado.";
  return { prompt, version: (prev?.version ?? 0) + 1 };
}

export async function saveDeliverable(taskId: string, agentId: string, version: number, content: string, log: unknown, started: string) {
  await run("INSERT INTO deliverables(id,task_id,agent_id,version,content,author,created_at) VALUES(?,?,?,?,?,?,?)", [newId(), taskId, agentId, version, content, agentId, now()]);
  await run("UPDATE tasks SET status='review', iteration=?, updated_at=? WHERE id=?", [version, now(), taskId]);
  await run("INSERT INTO runs(id,agent_id,task_id,kind,status,log,started_at,finished_at) VALUES(?,?,?,'task','ok',?,?,?)",
    [newId(), agentId, taskId, JSON.stringify(log), started, now()]);
}

export async function failTask(taskId: string, agentId: string, status: string, error: string, started: string) {
  await run("UPDATE tasks SET status=?, updated_at=? WHERE id=?", [status === "working" ? "queued" : status, now(), taskId]);
  await run("INSERT INTO runs(id,agent_id,task_id,kind,status,error,started_at,finished_at) VALUES(?,?,?,'task','error',?,?,?)",
    [newId(), agentId, taskId, error, started, now()]);
}

// Trabaja (o re-trabaja con los comentarios del CEO) una tarea y deja una nueva versión para revisión.
// Los agentes "claude-code" trabajan en tu PC: aquí solo se dejan en cola para el worker local.
export async function workOnTask(taskId: string) {
  const task = await get("SELECT * FROM tasks WHERE id=?", [taskId]);
  if (!task) throw new Error("Tarea no existe");
  const agent = (task.agent_id && (await getAgent(task.agent_id))) || (await getAgent("jefa-gabinete"));
  if (!agent) throw new Error("No hay agente para esta tarea");
  if (agent.id !== task.agent_id) await run("UPDATE tasks SET agent_id=? WHERE id=?", [agent.id, taskId]);
  if (agent.runner === "claude-code") {
    if (task.status !== "working") await run("UPDATE tasks SET status='queued', updated_at=? WHERE id=?", [now(), taskId]);
    return { ok: true as const, version: 0, local: true };
  }

  await run("UPDATE tasks SET status='working', updated_at=? WHERE id=?", [now(), taskId]);
  const { prompt, version } = await buildTaskPrompt(task);
  const ctx: ToolCtx = { agent, taskId, questions: [] };
  const started = now();
  try {
    const { text, log } = await runLoop(agent, [{ role: "system", content: await systemPrompt(agent) }, { role: "user", content: prompt }], ctx);
    let content = text.trim() || "_(El agente no devolvió contenido)_";
    if (ctx.questions.length) content += `\n\n## ❓ Preguntas para el CEO\n${ctx.questions.map((q) => `- ${q}`).join("\n")}`;
    await saveDeliverable(taskId, agent.id, version, content, log, started);
    return { ok: true as const, version };
  } catch (e: any) {
    await failTask(taskId, agent.id, task.status, e.message, started);
    return { ok: false as const, error: e.message as string };
  }
}

export async function chatWithAgent(agentId: string, text: string) {
  const agent = await getAgent(agentId);
  if (!agent) throw new Error("Agente no existe");
  const history = (await all("SELECT role, content FROM messages WHERE agent_id=? ORDER BY created_at DESC LIMIT 16", [agentId])).reverse();
  await run("INSERT INTO messages(id,agent_id,role,content,created_at) VALUES(?,?,'user',?,?)", [newId(), agentId, text, now()]);
  let live = "\n\nEstás conversando en vivo con el CEO. Responde de forma breve y directa (no hace falta el formato de entregable). Si te pide trabajo largo, crea tareas con delegate_task (a ti mismo si corresponde) para el próximo turno.";
  if (agent.id === "jefa-gabinete") {
    // Clara ve lo mismo que el CEO en su panel: prioridades y carga de trabajo de cada agente.
    const { prioritiesText } = await import("./priorities");
    const load = await all(`SELECT a.name, a.role, t.title, t.status FROM tasks t JOIN agents a ON a.id=t.agent_id
      WHERE t.status IN ('queued','working','changes','review') ORDER BY a.name, t.updated_at DESC LIMIT 40`);
    live += `\n\n## Prioridades del CEO ahora (en orden)\n${await prioritiesText()}\n\n## Trabajo en curso del equipo\n${load.map((l) => `- ${l.name} (${l.role}): ${l.title} [${l.status}]`).join("\n") || "- Nadie tiene trabajo en curso."}
\nSi el CEO pregunta "¿qué hago?" o "¿en qué me enfoco?", respóndele con las prioridades en orden y por qué. Toda orden que te dé, la conviertes en trabajo: revisas si ya existe un agente que sepa hacerlo y le delegas; si no existe, contratas uno con un rol claro y luego le delegas. Confírmale a quién asignaste cada cosa.`;
  }
  const messages: Msg[] = [
    { role: "system", content: (await systemPrompt(agent)) + live },
    ...history.map((m) => ({ role: m.role, content: m.content }) as Msg),
    { role: "user", content: text },
  ];
  const ctx: ToolCtx = { agent, questions: [] };
  const { text: reply, log } = await runLoop(agent, messages, ctx, 6);
  const tools = log.filter((l) => l.t === "tool").map((l: any) => l.name);
  await run("INSERT INTO messages(id,agent_id,role,content,meta,created_at) VALUES(?,?,'assistant',?,?,?)", [newId(), agentId, reply, JSON.stringify({ tools }), now()]);
  return { reply, tools };
}

// ── Turno (cada 30 min): correo → newsletter → (1 vez por hora) rutinas y cola de tareas → brief ──
export async function shift(opts: { maxTasks?: number; log?: (s: string) => void; force?: boolean } = {}) {
  const say = opts.log ?? (() => {});
  const { date, hour } = chileNow();
  // De noche (00–06) trabajan más tareas por turno para que a las 7 esté todo listo; de día siguen a ritmo normal.
  const night = hour < 7;
  const maxTasks = opts.maxTasks ?? Number((night ? process.env.MAX_TASKS_NIGHT : process.env.MAX_TASKS_PER_RUN) || (night ? 10 : 4));
  say(`Turno ${date} ${hour}:00 (Chile)`);

  const step = async (name: string, fn: () => Promise<unknown>) => { try { await fn(); } catch (e: any) { say(`⚠️ ${name}: ${e.message}`); } };
  const { mailCycle } = await import("./mail");
  const { weeklyDrafts, sendCampaigns } = await import("./newsletter");
  await step("correo", () => mailCycle(say));
  await step("newsletter", () => weeklyDrafts(say));
  await step("envíos", () => sendCampaigns(say));

  // Los agentes trabajan una vez por hora (el correo se revisa cada 30 min).
  const slot = `${date} ${hour}`;
  if (!opts.force && (await setting("last_shift")) === slot) return;
  await setSetting("last_shift", slot);

  for (const a of await activeAgents()) {
    if (!a.routine || a.routine_hour == null || hour < a.routine_hour) continue;
    const title = `Rutina ${date}: ${a.role}`;
    if (await get("SELECT id FROM tasks WHERE title=? AND agent_id=?", [title, a.id])) continue;
    await createTask({ title, brief: a.routine, agent_id: a.id, created_by: "rutina", priority: 2 });
    say(`+ rutina creada para ${a.name}`);
  }

  // Las tareas de agentes "claude-code" las toma el worker de tu PC, no este turno.
  const queue = await all(
    `SELECT t.id, t.title FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id
     WHERE t.status IN ('queued','changes') AND coalesce(a.runner,'cloud')!='claude-code' ORDER BY t.priority, t.created_at LIMIT ?`, [maxTasks]);
  for (const t of queue) {
    say(`→ ${t.title}`);
    const r = await workOnTask(t.id);
    say(r.ok ? `  ✓ v${r.version} lista para revisión` : `  ✗ ${r.error}`);
  }

  // El brief se arma en el turno de las 6:00 para que esté listo antes de las 7:00.
  const briefHour = Number(process.env.BRIEF_HOUR || 6);
  if (hour >= briefHour && !(await get("SELECT id FROM briefs WHERE date=?", [date]))) {
    await morningBrief();
    say("☀️ Brief matinal listo");
  }
}

export async function morningBrief() {
  const { date } = chileNow();
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const data = {
    fecha: date,
    correos_por_importancia: await all("SELECT account AS cuenta, from_name, from_email, category, importance, summary, suggested_action FROM emails WHERE status IN ('nuevo','pendiente') AND importance>=2 ORDER BY importance DESC, received_at DESC LIMIT 40"),
    otros_mensajes: await all("SELECT source, from_name, category, title, substr(body,1,300) AS body, occurred_at FROM events WHERE occurred_at>=? AND source!='calendar' ORDER BY occurred_at DESC LIMIT 40", [since]),
    newsletter_por_aprobar: await all("SELECT title, niche, subject FROM campaigns WHERE status='borrador'"),
    agenda_hoy: await all("SELECT title, body, occurred_at FROM events WHERE source='calendar' AND substr(occurred_at,1,10)=? ORDER BY occurred_at", [date]),
    mis_pendientes: await all("SELECT text, due, created_at FROM todos WHERE done=0 ORDER BY coalesce(due,'9999'), created_at LIMIT 30"),
    para_revisar: await all("SELECT t.title, a.name AS agente FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.status='review' ORDER BY t.priority LIMIT 30"),
    trabajado_anoche: await all("SELECT t.title, a.name AS agente, r.status FROM runs r JOIN tasks t ON t.id=r.task_id LEFT JOIN agents a ON a.id=r.agent_id WHERE r.started_at>=? ORDER BY r.started_at", [since]),
    bandeja_por_aprobar: await all("SELECT channel, recipient, subject FROM outbox WHERE status='pending' LIMIT 30"),
  };

  let content: string;
  const ema = (await get<Agent>("SELECT * FROM agents WHERE template_id='asistente-matinal' AND status='active'")) ?? null;
  try {
    if (!ema) throw new Error("sin asistente");
    const res = await chat([
      { role: "system", content: await systemPrompt(ema) },
      { role: "user", content: `Arma el brief matinal del CEO con estos datos (JSON):\n${JSON.stringify(data)}\n\nSecciones: "🔥 Lo más importante hoy" (máx 3), "📅 Agenda", "📧 Tus correos por importancia" (primero los de importancia 5 y 4: quién, qué quiere, en qué cuenta y la acción sugerida; luego un resumen agrupado del resto: clientes, estudiantes, amigos, compras que llegaron), "💬 Otros mensajes", "✅ Pendientes que vienen de ayer", "🌙 Lo que hizo tu equipo mientras dormías", "👀 Para revisar y aprobar" (incluye newsletters por aprobar). Si una sección no tiene datos, dilo en una línea. Sé breve.` },
    ], undefined, ema.model);
    content = (res.message.content as string) || "";
  } catch {
    content = fallbackBrief(data);
  }
  await run("INSERT INTO briefs(id,date,content,created_at) VALUES(?,?,?,?)", [newId(), date, content, now()]);
  return content;
}

function fallbackBrief(d: Record<string, any>) {
  const list = (rows: any[], f: (r: any) => string) => (rows.length ? rows.map((r) => `- ${f(r)}`).join("\n") : "- Nada por ahora");
  return `# ☀️ Brief ${d.fecha}
## 📅 Agenda
${list(d.agenda_hoy, (r) => `${r.occurred_at.slice(11, 16)} ${r.title}`)}
## 📧 Correos
${list(d.correos_por_importancia, (r) => `[${r.importance}★ ${r.cuenta}] ${r.from_name ?? r.from_email}: ${r.summary} → ${r.suggested_action}`)}
## ✅ Pendientes
${list(d.mis_pendientes, (r) => r.text)}
## 🌙 Lo que hizo tu equipo
${list(d.trabajado_anoche, (r) => `${r.agente}: ${r.title} (${r.status})`)}
## 👀 Para revisar
${list(d.para_revisar, (r) => `${r.title} — ${r.agente}`)}`;
}
