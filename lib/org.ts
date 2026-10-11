import { all, get, newId, now, run } from "./db";
import { areaTemplate, templateById, type Rank } from "./templates";

export type Agent = {
  id: string; area_id: string; template_id: string | null; name: string; role: string; rank: Rank;
  emoji: string | null; skills: string; system_prompt: string; model: string | null;
  routine: string | null; routine_hour: number | null; status: string; runner: string; created_at: string;
};
export type Area = { id: string; name: string; description: string | null; emoji: string | null };

const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// Crea el área si no existe (por id de plantilla o por nombre libre) y devuelve su id.
export async function ensureArea(idOrName: string, description = "", emoji = "🏢"): Promise<string> {
  const tpl = areaTemplate(idOrName);
  const id = tpl?.id ?? slug(idOrName);
  const existing = await get<Area>("SELECT * FROM areas WHERE id=? OR lower(name)=lower(?)", [id, idOrName]);
  if (existing) return existing.id;
  await run("INSERT INTO areas(id,name,description,emoji,created_at) VALUES(?,?,?,?,?)", [
    id, tpl?.name ?? idOrName, tpl?.description ?? description, tpl?.emoji ?? emoji, now(),
  ]);
  return id;
}

export async function hireFromTemplate(templateId: string, nameOverride?: string): Promise<Agent> {
  const t = templateById(templateId);
  if (!t) throw new Error(`No existe la plantilla "${templateId}"`);
  const areaId = await ensureArea(t.area);
  const id = (await get("SELECT id FROM agents WHERE id=?", [t.id])) ? `${t.id}-${newId().slice(0, 4)}` : t.id;
  await run(
    `INSERT INTO agents(id,area_id,template_id,name,role,rank,emoji,skills,system_prompt,routine,routine_hour,runner,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, areaId, t.id, nameOverride || t.name, t.role, t.rank, t.emoji, JSON.stringify(t.skills), t.prompt, t.routine ?? null, t.routine_hour ?? null, t.runner ?? "cloud", now()],
  );
  return (await getAgent(id))!;
}

export async function hireCustom(a: {
  area: string; name: string; role: string; rank?: string; emoji?: string; skills?: string[];
  prompt: string; routine?: string | null; routine_hour?: number | null; model?: string | null; runner?: string;
}): Promise<Agent> {
  const areaId = await ensureArea(a.area);
  const id = `${slug(a.role) || "agente"}-${newId().slice(0, 4)}`;
  await run(
    `INSERT INTO agents(id,area_id,name,role,rank,emoji,skills,system_prompt,routine,routine_hour,model,runner,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, areaId, a.name, a.role, a.rank || "senior", a.emoji || "🤖", JSON.stringify(a.skills ?? ["web_search", "read_url"]),
     a.prompt, a.routine || null, a.routine_hour ?? null, a.model || null, a.runner === "claude-code" ? "claude-code" : "cloud", now()],
  );
  return (await getAgent(id))!;
}

export const getAgent = (id: string) => get<Agent>("SELECT * FROM agents WHERE id=?", [id]);
export const activeAgents = () =>
  all<Agent & { area_name: string }>(
    "SELECT a.*, ar.name AS area_name FROM agents a JOIN areas ar ON ar.id=a.area_id WHERE a.status='active' ORDER BY ar.created_at, a.rank, a.created_at",
  );

export async function createTask(t: { title: string; brief?: string; agent_id?: string | null; parent_id?: string | null; priority?: number; created_by?: string }) {
  const id = newId();
  await run(
    "INSERT INTO tasks(id,title,brief,agent_id,parent_id,status,priority,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?,?,?)",
    [id, t.title, t.brief ?? "", t.agent_id ?? null, t.parent_id ?? null, t.priority ?? 2, t.created_by ?? "ceo", now(), now()],
  );
  return id;
}
