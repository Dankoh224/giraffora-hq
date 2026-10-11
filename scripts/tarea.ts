// Uso desde Claude Code o la terminal:
//   npm run tarea -- "Título" "Brief detallado" [agent_id]
// Crea la tarea (por defecto para la Jefa de Gabinete) y la trabaja de inmediato.
import { workOnTask } from "../lib/engine";
import { createTask } from "../lib/org";
import { get } from "../lib/db";

const [title, brief = "", agentId = "jefa-gabinete"] = process.argv.slice(2);
(async () => {
  if (!title) { console.log('Uso: npm run tarea -- "Título" "Brief" [agent_id]'); process.exitCode = 1; return; }
  const id = await createTask({ title, brief, agent_id: agentId });
  const r = await workOnTask(id);
  if (!r.ok) { console.error(r.error); process.exitCode = 1; return; }
  const d = await get("SELECT content FROM deliverables WHERE task_id=? ORDER BY version DESC LIMIT 1", [id]);
  console.log(d?.content);
})();
