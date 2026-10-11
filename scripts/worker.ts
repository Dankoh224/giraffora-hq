// Worker de tu PC. Mientras está encendido:
//  - copia cada entrega nueva a la carpeta Archivos/ (y detecta tus ediciones a mano)
//  - ejecuta con Claude Code las tareas de agentes locales (editor de video, ingeniera)
//  - con --todo también corre los turnos normales cada hora (si aún no usas GitHub Actions)
// Uso: npm run worker     |     npm run worker -- --todo
import { all } from "../lib/db";
import { shift } from "../lib/engine";
import { syncFiles } from "../lib/files";
import { runLocalTask } from "../lib/local-runner";

const ALSO_SHIFT = process.argv.includes("--todo");
const log = (s: string) => console.log(`[${new Date().toLocaleTimeString("es-CL")}] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastShiftHour = -1;

async function tick() {
  await syncFiles(log);
  const local = await all(
    `SELECT t.id, t.title, a.name FROM tasks t JOIN agents a ON a.id=t.agent_id
     WHERE a.runner='claude-code' AND t.status IN ('queued','changes') ORDER BY t.priority, t.created_at`);
  for (const t of local) {
    log(`🎬 ${t.name} empieza: ${t.title}`);
    const r = await runLocalTask(t.id);
    log(r.ok ? `   ✓ v${r.version} lista para revisión` : `   ✗ ${r.error}`);
    await syncFiles(log);
  }
  const h = new Date().getHours();
  if (ALSO_SHIFT && h !== lastShiftHour) {
    lastShiftHour = h;
    await shift({ log });
    await syncFiles(log);
  }
}

(async () => {
  log(`Worker de Giraffora HQ encendido${ALSO_SHIFT ? " (incluye turnos)" : ""}. Ctrl+C para detener.`);
  for (;;) {
    try { await tick(); } catch (e: any) { log(`⚠️ ${e.message}`); }
    await sleep(30_000);
  }
})();
