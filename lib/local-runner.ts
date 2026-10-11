// Agentes "claude-code": trabajan en TU PC, dentro de la carpeta de la tarea, con Claude Code
// en modo no interactivo (usa tu suscripción, sin API extra). Ideal para video, audio y código.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { get, now, run } from "./db";
import { buildTaskPrompt, failTask, saveDeliverable } from "./engine";
import { absPath, listDir, taskFolder, FILES_ROOT } from "./files";
import { getAgent } from "./org";

// Solo lo necesario: archivos dentro de la carpeta de la tarea + herramientas de video/código.
const ALLOWED = (process.env.CLAUDE_ALLOWED_TOOLS ||
  "Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Bash(ffmpeg:*),Bash(ffprobe:*),Bash(auto-editor:*),Bash(python:*),Bash(pip:*),Bash(curl:*),Bash(ls:*),Bash(mkdir:*),Bash(cp:*),Bash(mv:*),Bash(node:*),Bash(npm:*),Bash(npx:*)").split(",");

const TIMEOUT_MIN = Number(process.env.CLAUDE_TIMEOUT_MIN || 60);

function claude(prompt: string, cwd: string, system: string, extraDirs: string[]) {
  return new Promise<string>((resolve, reject) => {
    const args = ["-p", "--output-format", "text", "--permission-mode", "acceptEdits", "--append-system-prompt", system,
      "--allowedTools", ...ALLOWED, ...extraDirs.flatMap((d) => ["--add-dir", d])];
    const child = spawn(process.env.CLAUDE_BIN || "claude", args, { cwd, env: process.env, windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Claude Code superó ${TIMEOUT_MIN} min`)); }, TIMEOUT_MIN * 60e3);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(new Error(`No se pudo ejecutar Claude Code: ${e.message}`)); });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out.trim()) : reject(new Error(`Claude Code terminó con código ${code}: ${(err || out).slice(-800)}`));
    });
    child.stdin.end(prompt);
  });
}

export async function runLocalTask(taskId: string) {
  // Reclamar la tarea (evita que dos procesos la tomen a la vez)
  const claimed = await run("UPDATE tasks SET status='working', updated_at=? WHERE id=? AND status IN ('queued','changes')", [now(), taskId]);
  if (!claimed.rowsAffected) return { ok: false as const, error: "La tarea ya no está en cola" };
  const task = (await get("SELECT * FROM tasks WHERE id=?", [taskId]))!;
  const agent = (await getAgent(task.agent_id))!;
  const started = now();
  try {
    const rel = await taskFolder(taskId);
    const cwd = absPath(rel);
    await fs.mkdir(path.join(cwd, "resultado"), { recursive: true });
    const inputs = (await listDir(rel)).filter((e) => !["versiones", "imagenes", "resultado", "entrega.md"].includes(e.name));
    const recursos = path.join(FILES_ROOT, "Recursos");
    await fs.mkdir(recursos, { recursive: true });

    const { prompt, version } = await buildTaskPrompt(task);
    const full = `${prompt}

## Tu carpeta de trabajo
Estás en: ${cwd}
Archivos de entrada del CEO: ${inputs.length ? inputs.map((e) => `${e.name}${e.dir ? "/" : ""} (${(e.size / 1e6).toFixed(1)} MB)`).join(", ") : "ninguno"}
Recursos compartidos (música, sonidos, logos): ${recursos}
Guarda TODO lo que produzcas en la subcarpeta "resultado/". No borres ni modifiques los archivos de entrada.

Al terminar, responde SOLO con un informe en Markdown para el CEO: "# título", qué hiciste, la lista de archivos generados en resultado/ y "## Próximos pasos".`;

    const system = `Eres ${agent.name}, ${agent.role} de Giraffora (empresa de IA chilena). Escribes en español de Chile.\n\n${agent.system_prompt}`;
    const report = await claude(full, cwd, system, [recursos]);
    const results = await listDir(`${rel}/resultado`);
    const content = `${report}\n\n---\n📁 Archivos en \`resultado/\`: ${results.map((r) => `[${r.name}](/archivos?p=${encodeURIComponent(r.rel)})`).join(" · ") || "ninguno"}`;
    await saveDeliverable(taskId, agent.id, version, content, [{ t: "llm", model: "claude-code (local)" }], started);
    return { ok: true as const, version };
  } catch (e: any) {
    await failTask(taskId, agent.id, task.status, e.message, started);
    return { ok: false as const, error: e.message as string };
  }
}
