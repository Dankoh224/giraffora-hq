import { get } from "../lib/db";
import { createTask } from "../lib/org";
import { workOnTask } from "../lib/engine";
(async () => {
  const m = await get("SELECT content FROM messages WHERE agent_id='jefa-gabinete' AND role='user' AND content LIKE '%Feria de Desarrollo%' ORDER BY created_at DESC LIMIT 1");
  if (!m) return console.log("no encontré el mensaje");
  const id = await createTask({ title: "Feria La Pintana (mar 20-oct): preparar stand 9:00–15:00", agent_id: "jefa-gabinete", priority: 1,
    brief: `El CEO te escribió por chat y no alcanzaste a responder (falló el modelo de respaldo). Resuélvelo ahora: organiza el trabajo, contrata/delega lo que haga falta y confírmale el plan.\n\n${m.content}` });
  const r = await workOnTask(id);
  console.log("tarea", id, r);
})();
