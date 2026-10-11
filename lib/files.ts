// Carpeta "Archivos" en tu PC: cada entrega de cada agente queda como archivo que puedes abrir,
// editar, copiar o borrar. Estructura: Archivos/<Área>/<Agente - Cargo>/<fecha título [id]>/
//   entrega.md        ← la última versión (si la editas, los agentes ven tu versión)
//   versiones/vN.md   ← historial
//   imagenes/         ← imágenes generadas, descargadas
//   (tus archivos de entrada, ej. videos)   resultado/ ← lo que produce Claude Code
import fs from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import path from "node:path";
import { all, get, newId, now, run } from "./db";

export const FILES_ROOT = path.resolve(process.env.FILES_DIR || "Archivos");
export const TRASH = "_Papelera";

// En Vercel o GitHub Actions no existe tu disco: ahí la carpeta no está disponible.
export const filesAvailable = () => !process.env.VERCEL && !process.env.GITHUB_ACTIONS;

export function absPath(rel = "") {
  const p = path.resolve(FILES_ROOT, rel);
  if (p !== FILES_ROOT && !p.startsWith(FILES_ROOT + path.sep)) throw new Error("Ruta fuera de Archivos");
  return p;
}
export const toRel = (abs: string) => path.relative(FILES_ROOT, abs).split(path.sep).join("/");

const clean = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().slice(0, 60) || "sin nombre";

export async function taskFolder(taskId: string): Promise<string> {
  const t = await get(
    `SELECT t.id, t.title, t.folder, t.created_at, a.name, a.role, ar.name AS area FROM tasks t
     LEFT JOIN agents a ON a.id=t.agent_id LEFT JOIN areas ar ON ar.id=a.area_id WHERE t.id=?`, [taskId]);
  if (!t) throw new Error("Tarea no existe");
  let rel: string = t.folder;
  if (!rel) {
    rel = [clean(t.area ?? "General"), clean(`${t.name ?? "Sin asignar"} - ${t.role ?? ""}`),
      `${String(t.created_at).slice(0, 10)} ${clean(t.title)} [${t.id.slice(0, 4)}]`].join("/");
    await run("UPDATE tasks SET folder=? WHERE id=?", [rel, taskId]);
  }
  await fs.mkdir(absPath(rel), { recursive: true });
  return rel;
}

async function downloadImages(md: string, dir: string, version: number) {
  const re = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g;
  let out = md, i = 0;
  for (const m of md.matchAll(re)) {
    i++;
    try {
      const r = await fetch(m[2], { signal: AbortSignal.timeout(90000) });
      if (!r.ok) continue;
      const ext = (r.headers.get("content-type") ?? "").includes("png") ? "png" : "jpg";
      const name = `imagenes/v${version}-${i}.${ext}`;
      await fs.mkdir(path.join(dir, "imagenes"), { recursive: true });
      await fs.writeFile(path.join(dir, name), Buffer.from(await r.arrayBuffer()));
      out = out.replace(m[0], `![${m[1]}](${name})`);
    } catch { /* la imagen queda con su link original */ }
  }
  return out;
}

// Sincroniza base de datos ↔ carpeta. Lo llama el worker local y la página Archivos.
export async function syncFiles(log: (s: string) => void = () => {}) {
  if (!filesAvailable()) return;
  await fs.mkdir(FILES_ROOT, { recursive: true });

  // 1) Tus ediciones a mano en entrega.md → nueva versión "editada por el CEO"
  for (const t of await all("SELECT id, folder, file_mtime FROM tasks WHERE folder IS NOT NULL AND file_mtime IS NOT NULL")) {
    const file = absPath(`${t.folder}/entrega.md`);
    const st = await fs.stat(file).catch(() => null);
    if (!st || st.mtimeMs <= t.file_mtime + 1500) continue;
    const content = await fs.readFile(file, "utf8");
    const last = await get("SELECT version FROM deliverables WHERE task_id=? ORDER BY version DESC LIMIT 1", [t.id]);
    const v = (last?.version ?? 0) + 1;
    await run("INSERT INTO deliverables(id,task_id,agent_id,version,content,author,exported_at,created_at) VALUES(?,?,NULL,?,?,'ceo',?,?)",
      [newId(), t.id, v, content, now(), now()]);
    await fs.mkdir(absPath(`${t.folder}/versiones`), { recursive: true });
    await fs.writeFile(absPath(`${t.folder}/versiones/v${v} (editada por ti).md`), content);
    await run("UPDATE tasks SET file_mtime=?, updated_at=? WHERE id=?", [st.mtimeMs, now(), t.id]);
    log(`✍️ tu edición de "${t.folder}" quedó como v${v}`);
  }

  // 2) Entregas nuevas de los agentes → archivos
  const pending = await all(
    `SELECT d.id, d.task_id, d.version, d.content, (SELECT MAX(version) FROM deliverables x WHERE x.task_id=d.task_id) AS latest
     FROM deliverables d WHERE d.exported_at IS NULL ORDER BY d.created_at`);
  for (const d of pending) {
    const rel = await taskFolder(d.task_id);
    const dir = absPath(rel);
    const content = await downloadImages(d.content, dir, d.version);
    await fs.mkdir(path.join(dir, "versiones"), { recursive: true });
    await fs.writeFile(path.join(dir, "versiones", `v${d.version}.md`), content.replace(/\]\(imagenes\//g, "](../imagenes/"));
    if (d.version === d.latest) {
      await fs.writeFile(path.join(dir, "entrega.md"), content);
      const st = await fs.stat(path.join(dir, "entrega.md"));
      await run("UPDATE tasks SET file_mtime=? WHERE id=?", [st.mtimeMs, d.task_id]);
    }
    await run("UPDATE deliverables SET exported_at=? WHERE id=?", [now(), d.id]);
    log(`📄 ${rel}/v${d.version}`);
    await exportWord(d.task_id, d.version, d.content, dir, log);
  }

  // 3) Newsletter: Excel de suscriptores por nicho y plantillas
  const { syncSubscriberSheets, syncTemplates } = await import("./subscribers");
  await syncTemplates();
  await syncSubscriberSheets(log);

  // 4) Licitaciones: texto de bases y anexos
  const { syncTenderDocs } = await import("./tenders");
  await syncTenderDocs(log);
}

export type Entry = { name: string; rel: string; dir: boolean; size: number; mtime: number };

export async function listDir(rel = ""): Promise<Entry[]> {
  const dir = absPath(rel);
  const items = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: Entry[] = [];
  for (const it of items) {
    if (it.name.startsWith(".")) continue;
    const st = await fs.stat(path.join(dir, it.name)).catch(() => null);
    if (!st) continue;
    out.push({ name: it.name, rel: toRel(path.join(dir, it.name)), dir: it.isDirectory(), size: st.size, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => Number(b.dir) - Number(a.dir) || (a.name === TRASH ? 1 : b.name === TRASH ? -1 : a.name.localeCompare(b.name)));
}

// "Eliminar" = mover a _Papelera (se puede recuperar). Borrar desde la Papelera sí es definitivo.
export async function removeEntry(rel: string) {
  const src = absPath(rel);
  if (src === FILES_ROOT) throw new Error("No se puede borrar la raíz");
  if (rel === TRASH || rel.startsWith(`${TRASH}/`)) return fs.rm(src, { recursive: true, force: true });
  const dest = absPath(`${TRASH}/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")} ${path.basename(src)}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(src, dest);
}

export async function saveUpload(relDir: string, name: string, body: ReadableStream<Uint8Array>) {
  const dir = absPath(relDir);
  await fs.mkdir(dir, { recursive: true });
  const file = absPath(`${relDir}/${clean(name).slice(0, 120) || "archivo"}`);
  const ws = createWriteStream(file);
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!ws.write(value)) await new Promise<void>((r) => ws.once("drain", () => r()));
  }
  await new Promise<void>((res, rej) => ws.end((e?: Error | null) => (e ? rej(e) : res())));
  return toRel(file);
}

export const exists = (rel: string) => existsSync(absPath(rel));

export const MIME: Record<string, string> = {
  md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8", csv: "text/csv; charset=utf-8", json: "application/json",
  srt: "text/plain; charset=utf-8", vtt: "text/vtt", html: "text/plain; charset=utf-8", pdf: "application/pdf",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", ogg: "audio/ogg",
};
export const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
export const TEXT_EXT = new Set(["md", "txt", "csv", "json", "srt", "vtt", "html", "py", "js", "ts"]);

// Cada entrega se guarda también como Word con la plantilla de Giraffora (Archivos/Plantillas/Word).

export async function wordTemplatePath(): Promise<string | null> {
  const dir = absPath("Plantillas/Word");
  await fs.mkdir(dir, { recursive: true });
  const preferred = (await get<{ value: string }>("SELECT value FROM settings WHERE key='word_template'"))?.value;
  const files = (await fs.readdir(dir)).filter((f) => /\.docx$/i.test(f) && !f.startsWith("~$"));
  const pick = files.find((f) => f === preferred) ?? files[0];
  return pick ? path.join(dir, pick) : null;
}

async function exportWord(taskId: string, version: number, content: string, dir: string, log: (s: string) => void) {
  const t = await get("SELECT t.title, a.template_id FROM tasks t LEFT JOIN agents a ON a.id=t.agent_id WHERE t.id=?", [taskId]);
  if (!t) return;
  const { fillTemplateCopy, splitMeta } = await import("./docx");
  const title = splitMeta(content).meta.titulo || t.title;
  const name = `${clean(title).slice(0, 70)} v${version}.docx`;
  try {
    // Copia de la plantilla en la carpeta de la tarea → se rellena esa copia
    await fillTemplateCopy(await wordTemplatePath(), path.join(dir, name), content, {
      titulo: title, tipo: t.template_id === "redactora-ofertas" ? "PROPUESTA TÉCNICA Y COMERCIAL" : "INFORME",
      fecha: new Date().toLocaleDateString("es-CL", { day: "numeric", month: "long", year: "numeric" }),
    });
    log(`📘 ${name}`);
  } catch {
    log(`⚠️ No pude escribir ${name} (¿está abierto en Word?)`);
  }
}
