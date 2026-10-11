// Cerebro Claude con tu plan Pro: cada agente piensa con Claude Code en modo no interactivo,
// con SU personalidad y SOLO sus habilidades (servidor MCP de Giraffora) + búsqueda web
// + las conexiones externas que le actives (Higgsfield, Canva… configuradas en tu Claude Code).
// Funciona en tu PC (tu sesión) y en GitHub Actions (CLAUDE_CODE_OAUTH_TOKEN de `claude setup-token`).
// Si se agota el cupo del plan o no hay Claude disponible (p. ej. en Vercel), responde Gemini.
//
// Modelos según dificultad: simple → Haiku (rápido), normal → Sonnet, complejo → Opus.
// Velocidad: Claude Code tarda ~25 s en arrancar en este PC, así que para conversar se mantiene
// una sesión "despierta" por agente (los mensajes siguientes tardan 1–10 s) y se duerme tras 20 min.
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Agent } from "./org";

export type Level = "simple" | "normal" | "complejo";
const ROOT = process.cwd();
let available: boolean | null = null;
let exhaustedUntil = 0; // si Claude dice "límite alcanzado", se pausa 1 hora y responde Gemini

export function claudeEnabled() {
  if ((process.env.BRAIN || "claude") !== "claude" || process.env.VERCEL) return false;
  if (Date.now() < exhaustedUntil) return false;
  if (available === null) {
    const r = spawnSync(process.env.CLAUDE_BIN || "claude", ["--version"], { timeout: 20000, windowsHide: true });
    available = r.status === 0;
  }
  return available;
}

export function modelFor(level: Level, agent?: Pick<Agent, "model"> | null) {
  if (agent?.model?.startsWith("claude:")) return agent.model.slice(7);
  if (level === "simple") return process.env.CLAUDE_MODEL_SIMPLE || "haiku";
  if (level === "complejo") return process.env.CLAUDE_MODEL_COMPLEX || "opus";
  return process.env.CLAUDE_MODEL || "sonnet";
}

function absDbUrl() {
  const url = process.env.DATABASE_URL || "file:data/empresa.db";
  return url.startsWith("file:") && !path.isAbsolute(url.slice(5)) ? `file:${path.join(ROOT, url.slice(5))}` : url;
}

function baseEnv() {
  const env = {} as NodeJS.ProcessEnv;
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  return Object.assign(env, {
    DATABASE_URL: absDbUrl(), FILES_DIR: path.resolve(process.env.FILES_DIR || path.join(ROOT, "Archivos")),
    DISABLE_AUTOUPDATER: "1", CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  });
}

const WEB = ["WebSearch", "WebFetch"];

// Arma los argumentos: modelo, personalidad, herramientas permitidas y servidores MCP.
function buildArgs(o: { agent: Agent; system: string; model: string; withTools: boolean; taskId?: string; work: string; questionsFile: string; env: NodeJS.ProcessEnv }) {
  const args = ["--model", o.model, "--system-prompt", o.system];
  if (!o.withTools) return [...args, "--strict-mcp-config", "--tools", ""];
  const skills: string[] = JSON.parse(o.agent.skills || "[]");
  const web = skills.some((s) => s === "web_search" || s === "read_url");
  const external: string[] = JSON.parse((o.agent as any).connections || "[]");
  const cfg = path.join(o.work, "mcp.json");
  fs.writeFileSync(cfg, JSON.stringify({
    mcpServers: {
      giraffora: {
        command: process.execPath,
        // Ruta absoluta al cargador de tsx: Claude Code lanza el servidor desde otra carpeta.
        args: ["--import", pathToFileURL(path.join(ROOT, "node_modules", "tsx", "dist", "loader.mjs")).href, path.join(ROOT, "scripts", "mcp-server.ts")],
        env: { ...o.env, GIRAFFORA_AGENT_ID: o.agent.id, GIRAFFORA_TASK_ID: o.taskId ?? "", GIRAFFORA_QUESTIONS_FILE: o.questionsFile },
      },
    },
  }));
  // Sin conexiones externas: solo Giraffora (más rápido y seguro). Con ellas: también las de tu Claude Code.
  if (!external.length) args.push("--strict-mcp-config");
  return [...args, "--mcp-config", cfg, "--tools", web ? WEB.join(",") : "",
    "--allowedTools", "mcp__giraffora", ...external.map((e) => `mcp__${e}`), ...(web ? WEB : [])];
}

function noteLimit(msg: string) {
  if (/limit|usage|quota|rate|overloaded|5-hour|weekly/i.test(msg)) exhaustedUntil = Date.now() + 3600e3;
}

// ── Trabajo de una vez (tareas del turno) ──
export async function claudeThink(opts: { agent: Agent; system: string; prompt: string; taskId?: string; withTools?: boolean; level?: Level; timeoutMin?: number }) {
  const { agent, system, prompt, taskId, withTools = true, level = "normal" } = opts;
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "giraffora-"));
  const questionsFile = path.join(work, "preguntas.txt");
  const env = baseEnv();
  const run = (model: string) => new Promise<string>((resolve, reject) => {
    const args = ["-p", "--output-format", "json", ...buildArgs({ agent, system, model, withTools, taskId, work, questionsFile, env })];
    const child = spawn(process.env.CLAUDE_BIN || "claude", args, { cwd: work, env, windowsHide: true });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Claude tardó demasiado")); }, (opts.timeoutMin ?? 20) * 60e3);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); code === 0 || out.trim().startsWith("{") ? resolve(out) : reject(new Error((err || out).slice(-600))); });
    child.stdin.end(prompt);
  });
  try {
    let model = modelFor(level, agent);
    let raw: string;
    try { raw = await run(model); }
    catch (e: any) {
      if (model === "sonnet" || /limit|usage|quota/i.test(e.message)) throw e;
      model = "sonnet"; // p. ej. Opus no incluido en el plan → Sonnet
      raw = await run(model);
    }
    const res = JSON.parse(raw.slice(raw.indexOf("{")));
    if (res.is_error) throw new Error(String(res.result || res.subtype || "error de Claude"));
    const questions = fs.existsSync(questionsFile) ? fs.readFileSync(questionsFile, "utf8").split("\n").filter(Boolean) : [];
    return { text: String(res.result ?? ""), questions, model: `claude:${res.modelUsage ? Object.keys(res.modelUsage)[0] : model}` };
  } catch (e: any) {
    noteLimit(e.message);
    throw e;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ── Sesiones despiertas (conversación en vivo) ──
type Session = {
  child: ChildProcessWithoutNullStreams; work: string; model: string; lastUsed: number;
  buf: string; waiting: { resolve: (v: { text: string; model: string }) => void; reject: (e: Error) => void } | null; queue: Promise<unknown>;
};
const g = globalThis as unknown as { __claudeSessions?: Map<string, Session>; __claudeSweep?: NodeJS.Timeout };
const pool = (g.__claudeSessions ??= new Map());
g.__claudeSweep ??= setInterval(() => {
  for (const [k, s] of pool) if (Date.now() - s.lastUsed > 20 * 60e3) { s.child.stdin.end(); pool.delete(k); }
}, 60e3).unref();

function openSession(key: string, agent: Agent, system: string, level: Level): Session {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "giraffora-chat-"));
  const env = baseEnv();
  const model = modelFor(level, agent);
  const args = ["-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    ...buildArgs({ agent, system, model, withTools: true, work, questionsFile: path.join(work, "preguntas.txt"), env })];
  const child = spawn(process.env.CLAUDE_BIN || "claude", args, { cwd: work, env, windowsHide: true });
  const s: Session = { child, work, model, lastUsed: Date.now(), buf: "", waiting: null, queue: Promise.resolve() };
  child.stdout.on("data", (d) => {
    s.buf += d;
    let i;
    while ((i = s.buf.indexOf("\n")) >= 0) {
      const line = s.buf.slice(0, i); s.buf = s.buf.slice(i + 1);
      let m: any; try { m = JSON.parse(line); } catch { continue; }
      if (m.type === "result" && s.waiting) {
        const w = s.waiting; s.waiting = null;
        if (m.is_error) { noteLimit(String(m.result)); w.reject(new Error(String(m.result || "error de Claude"))); }
        else w.resolve({ text: String(m.result ?? ""), model: `claude:${m.modelUsage ? Object.keys(m.modelUsage)[0] : model}` });
      }
    }
  });
  const die = (why: string) => {
    pool.delete(key);
    s.waiting?.reject(new Error(why)); s.waiting = null;
    fs.rmSync(work, { recursive: true, force: true });
  };
  child.on("error", (e) => die(e.message));
  child.on("close", () => die("La sesión de Claude se cerró"));
  pool.set(key, s);
  return s;
}

export function sessionAsk(key: string, agent: Agent, system: string, message: string, level: Level = "normal") {
  const s = pool.get(key) ?? openSession(key, agent, system, level);
  const ask = () => new Promise<{ text: string; model: string }>((resolve, reject) => {
    s.lastUsed = Date.now();
    const timer = setTimeout(() => { if (s.waiting) { s.waiting = null; reject(new Error("Claude no respondió a tiempo")); } }, 5 * 60e3);
    const done = (fn: () => void) => { clearTimeout(timer); fn(); };
    s.waiting = { resolve: (v: { text: string; model: string }) => done(() => resolve(v)), reject: (e: Error) => done(() => reject(e)) };
    s.child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: message } }) + "\n");
  });
  const p = s.queue.then(ask, ask); // un mensaje a la vez por sesión
  s.queue = p.catch(() => {});
  return p;
}

export const hasSession = (key: string) => pool.has(key);
