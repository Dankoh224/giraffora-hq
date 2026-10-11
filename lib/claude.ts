// Cerebro Claude con tu plan Pro: cada agente piensa con Claude Code en modo no interactivo,
// con SU personalidad y SOLO sus habilidades (vía el servidor MCP de Giraffora) + búsqueda web.
// Funciona en tu PC (tu sesión) y en GitHub Actions (CLAUDE_CODE_OAUTH_TOKEN de `claude setup-token`).
// Si se agota el cupo del plan o no hay Claude disponible (p. ej. en Vercel), se usa Gemini de respaldo.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Agent } from "./org";

const ROOT = process.cwd();
let available: boolean | null = null;
let exhaustedUntil = 0; // si Claude dice "límite alcanzado", se pausa 1 hora y responde Gemini

export function claudeEnabled() {
  if ((process.env.BRAIN || "claude") !== "claude" || process.env.VERCEL) return false;
  if (Date.now() < exhaustedUntil) return false;
  if (available === null) {
    const r = spawnSync(process.env.CLAUDE_BIN || "claude", ["--version"], { timeout: 15000, windowsHide: true });
    available = r.status === 0;
  }
  return available;
}

function absDbUrl() {
  const url = process.env.DATABASE_URL || "file:data/empresa.db";
  return url.startsWith("file:") && !path.isAbsolute(url.slice(5)) ? `file:${path.join(ROOT, url.slice(5))}` : url;
}

const WEB = ["WebSearch", "WebFetch"];

export async function claudeThink(opts: { agent: Agent; system: string; prompt: string; taskId?: string; withTools?: boolean; timeoutMin?: number }) {
  const { agent, system, prompt, taskId, withTools = true } = opts;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "giraffora-"));
  const questionsFile = path.join(work, "preguntas.txt");
  const skills: string[] = JSON.parse(agent.skills || "[]");
  const web = withTools && skills.some((s) => s === "web_search" || s === "read_url");

  const env = {} as NodeJS.ProcessEnv;
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, { DATABASE_URL: absDbUrl(), FILES_DIR: path.resolve(process.env.FILES_DIR || path.join(ROOT, "Archivos")) });

  const args = ["-p", "--output-format", "json", "--model", agent.model?.startsWith("claude:") ? agent.model.slice(7) : process.env.CLAUDE_MODEL || "sonnet",
    "--system-prompt", system, "--strict-mcp-config"];
  if (withTools) {
    const mcp = {
      mcpServers: {
        giraffora: {
          command: process.execPath,
          // Ruta absoluta al cargador de tsx: Claude Code lanza el servidor desde otra carpeta.
          args: ["--import", pathToFileURL(path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href, path.join(ROOT, "scripts", "mcp-server.ts")],
          env: { ...env, GIRAFFORA_AGENT_ID: agent.id, GIRAFFORA_TASK_ID: taskId ?? "", GIRAFFORA_QUESTIONS_FILE: questionsFile },
          cwd: ROOT,
        },
      },
    };
    const cfg = path.join(work, "mcp.json");
    fs.writeFileSync(cfg, JSON.stringify(mcp));
    args.push("--mcp-config", cfg, "--tools", web ? WEB.join(",") : "", "--allowedTools", "mcp__giraffora", ...(web ? WEB : []));
  } else {
    args.push("--tools", "");
  }

  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.env.CLAUDE_BIN || "claude", args, { cwd: work, env, windowsHide: true });
      let out = "", err = "";
      const timer = setTimeout(() => { child.kill(); reject(new Error("Claude tardó demasiado")); }, (opts.timeoutMin ?? 15) * 60e3);
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => { clearTimeout(timer); code === 0 || out.trim().startsWith("{") ? resolve(out) : reject(new Error((err || out).slice(-600))); });
      child.stdin.end(prompt);
    });
    const res = JSON.parse(raw.slice(raw.indexOf("{")));
    if (res.is_error) throw new Error(String(res.result || res.subtype || "error de Claude"));
    const questions = fs.existsSync(questionsFile) ? fs.readFileSync(questionsFile, "utf8").split("\n").filter(Boolean) : [];
    return { text: String(res.result ?? ""), questions, model: `claude:${res.modelUsage ? Object.keys(res.modelUsage)[0] : "sonnet"}` };
  } catch (e: any) {
    if (/limit|usage|quota|rate|overloaded|5-hour|weekly/i.test(e.message)) exhaustedUntil = Date.now() + 3600e3;
    throw e;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
