// Documentos de licitaciones: cada licitación tiene su carpeta en Archivos/Licitaciones/<código nombre>/.
// Ahí subes las bases, anexos y formularios que descargas de Mercado Público. La app extrae el texto
// (PDF, Word, Excel, texto) y lo guarda en la base de datos para que la Cazadora revise requisitos y la
// Redactora arme la oferta, aunque trabajen en la nube.
import ExcelJS from "exceljs";
import JSZip from "jszip";
import fs from "node:fs/promises";
import path from "node:path";
import { all, get, newId, now, run } from "./db";
import { absPath, filesAvailable } from "./files";

const clean = (s: string) => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);

export async function tenderFolder(tenderId: string) {
  const t = await get("SELECT id, code, name, folder FROM tenders WHERE id=?", [tenderId]);
  if (!t) throw new Error("Licitación no existe");
  let rel: string = t.folder;
  if (!rel) {
    rel = `Licitaciones/${clean(`${t.code} ${t.name}`)}`;
    await run("UPDATE tenders SET folder=? WHERE id=?", [rel, t.id]);
  }
  if (filesAvailable()) await fs.mkdir(absPath(rel), { recursive: true });
  return rel;
}

async function extractText(file: string): Promise<string | null> {
  const ext = path.extname(file).toLowerCase();
  const buf = await fs.readFile(file);
  if (ext === ".pdf") {
    const { extractText: pdfText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await pdfText(pdf, { mergePages: true });
    return String(text);
  }
  if (ext === ".docx") {
    const xml = await (await JSZip.loadAsync(buf)).file("word/document.xml")?.async("string");
    return xml ? xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") : null;
  }
  if (ext === ".xlsx") {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as any);
    const out: string[] = [];
    wb.eachSheet((ws) => {
      out.push(`## Hoja: ${ws.name}`);
      ws.eachRow((row) => out.push((row.values as any[]).slice(1).map((v) => (v && typeof v === "object" ? v.text ?? v.result ?? "" : v ?? "")).join(" | ")));
    });
    return out.join("\n");
  }
  if ([".txt", ".md", ".csv", ".html", ".htm"].includes(ext)) return buf.toString("utf8").replace(/<[^>]+>/g, " ");
  return null; // imágenes, zip, etc.: quedan en la carpeta pero sin texto
}

// Lee las carpetas de las licitaciones y guarda el texto de los documentos nuevos o modificados.
export async function syncTenderDocs(log: (s: string) => void = () => {}) {
  if (!filesAvailable()) return;
  for (const t of await all("SELECT id, folder FROM tenders WHERE folder IS NOT NULL")) {
    const dir = absPath(t.folder);
    const files = await fs.readdir(dir).catch(() => [] as string[]);
    for (const f of files) {
      const full = path.join(dir, f);
      const st = await fs.stat(full).catch(() => null);
      if (!st?.isFile() || f.startsWith("~$")) continue;
      const ex = await get("SELECT updated_at FROM tender_docs WHERE tender_id=? AND name=?", [t.id, f]);
      if (ex && new Date(ex.updated_at).getTime() >= st.mtimeMs - 1000) continue;
      let text: string | null = null;
      try { text = await extractText(full); } catch (e: any) { text = `(no se pudo leer: ${e.message})`; }
      await run(`INSERT INTO tender_docs(id,tender_id,name,size,text,updated_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(tender_id,name) DO UPDATE SET size=excluded.size, text=excluded.text, updated_at=excluded.updated_at`,
        [newId(), t.id, f, st.size, text ? text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").slice(0, 400_000) : null, new Date(st.mtimeMs).toISOString()]);
      log(`📎 ${f} leído (${t.folder})`);
    }
    // Documentos borrados de la carpeta → se quitan de la base
    const names = await all("SELECT name FROM tender_docs WHERE tender_id=?", [t.id]);
    for (const n of names) if (!files.includes(n.name)) await run("DELETE FROM tender_docs WHERE tender_id=? AND name=?", [t.id, n.name]);
  }
}

export async function createManualTender(code: string, name: string, url: string | null, buyer: string | null, close: string | null) {
  const ex = await get("SELECT id FROM tenders WHERE code=?", [code]);
  if (ex) return ex.id as string;
  const id = newId();
  await run("INSERT INTO tenders(id,code,name,buyer,url,close_date,can_comply,status,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,'parcial','nueva','Agregada por el CEO; falta revisar requisitos con los documentos.',?,?)",
    [id, code, name, buyer, url, close, now(), now()]);
  await tenderFolder(id);
  return id;
}
