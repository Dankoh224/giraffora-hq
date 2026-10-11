// Carpeta Archivos/Newsletter:
//   Suscriptores/<Nicho>.xlsx  ← un Excel por nicho. Cada alta es una fila nueva; cada baja marca su fila
//                                 (Estado = Baja + fecha). Tus columnas y notas extra se respetan.
//   Plantillas/*.html           ← plantillas de newsletter de Giraffora. Las que dejes aquí quedan
//                                 disponibles para los envíos (y las creadas en la app se guardan aquí).
// La base de datos manda; los Excel son el reflejo legible que puedes abrir, filtrar o compartir.
import ExcelJS from "exceljs";
import fs from "node:fs/promises";
import path from "node:path";
import { all, get, newId, now, run } from "./db";
import { niches } from "./contacts";
import { absPath, filesAvailable } from "./files";

const COLS = [
  { header: "Fecha alta", key: "alta", width: 14 }, { header: "Nombre", key: "nombre", width: 26 },
  { header: "Correo", key: "correo", width: 32 }, { header: "Organización", key: "org", width: 26 },
  { header: "Teléfono", key: "tel", width: 16 }, { header: "Origen", key: "origen", width: 24 },
  { header: "Estado", key: "estado", width: 10 }, { header: "Fecha baja", key: "baja", width: 14 },
];
const d = (iso?: string | null) => (iso ? String(iso).slice(0, 10) : "");

async function syncSheet(file: string, people: any[]) {
  const wb = new ExcelJS.Workbook();
  const exists = await fs.stat(file).then(() => true).catch(() => false);
  if (exists) await wb.xlsx.readFile(file);
  let ws = wb.getWorksheet("Suscriptores");
  if (!ws) {
    ws = wb.addWorksheet("Suscriptores", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = COLS;
    ws.getRow(1).font = { bold: true };
    ws.autoFilter = { from: "A1", to: "H1" };
  }
  const header = (ws.getRow(1).values as any[]).map((v) => String(v ?? "").trim());
  const col = (h: string) => header.indexOf(h); // índice 1-based de exceljs
  const [cMail, cEstado, cBaja] = [col("Correo"), col("Estado"), col("Fecha baja")];
  const rows = new Map<string, ExcelJS.Row>();
  ws.eachRow((row, i) => { if (i > 1) rows.set(String(row.getCell(cMail).text).trim().toLowerCase(), row); });

  let changed = !exists;
  for (const p of people) {
    const estado = p.subscribed && !p.bounced ? "Activo" : p.bounced ? "Rebotó" : "Baja";
    const row = rows.get(p.email.toLowerCase());
    if (!row) {
      const r = ws.addRow([]);
      const set = (h: string, v: string) => { const c = col(h); if (c > 0) r.getCell(c).value = v; };
      set("Fecha alta", d(p.created_at)); set("Nombre", p.name ?? ""); set("Correo", p.email); set("Organización", p.company ?? "");
      set("Teléfono", p.phone ?? ""); set("Origen", p.source ?? ""); set("Estado", estado); set("Fecha baja", estado === "Baja" ? d(p.unsubscribed_at) : "");
      changed = true;
    } else if (row.getCell(cEstado).text !== estado) {
      row.getCell(cEstado).value = estado;
      row.getCell(cBaja).value = estado === "Baja" ? d(p.unsubscribed_at) : "";
      changed = true;
    }
    const r = rows.get(p.email.toLowerCase()) ?? ws.lastRow!;
    const color = estado === "Activo" ? undefined : "FF9A9A9A";
    if (r.getCell(cEstado).font?.color?.argb !== color) r.eachCell((c) => { c.font = color ? { color: { argb: color } } : {}; });
  }
  if (changed) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await wb.xlsx.writeFile(file).catch(() => { /* el Excel está abierto: se actualiza en la próxima sincronización */ });
  }
  return changed;
}

export async function syncSubscriberSheets(log: (s: string) => void = () => {}) {
  if (!filesAvailable()) return;
  const list = await niches();
  const people = await all("SELECT * FROM contacts WHERE email IS NOT NULL AND email!='' ORDER BY created_at");
  const groups: [string, any[]][] = list.map((n) => [n.name, people.filter((p) => (p.niches ?? "").split(",").includes(n.id))]);
  groups.push(["Sin nicho", people.filter((p) => !p.niches)]);
  for (const [name, ps] of groups) {
    if (!ps.length) continue;
    if (await syncSheet(absPath(`Newsletter/Suscriptores/${name}.xlsx`), ps)) log(`📗 Suscriptores/${name}.xlsx actualizado`);
  }
}

export async function syncTemplates() {
  if (!filesAvailable()) return;
  const dir = absPath("Newsletter/Plantillas");
  await fs.mkdir(dir, { recursive: true });
  const files = (await fs.readdir(dir)).filter((f) => /\.html?$/i.test(f));
  for (const f of files) {
    const name = f.replace(/\.html?$/i, "");
    const st = await fs.stat(path.join(dir, f));
    const ex = await get("SELECT updated_at FROM email_templates WHERE name=?", [name]);
    if (!ex || new Date(ex.updated_at).getTime() < st.mtimeMs - 1000)
      await run("INSERT INTO email_templates(id,name,html,updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET html=excluded.html, updated_at=excluded.updated_at",
        [newId(), name, await fs.readFile(path.join(dir, f), "utf8"), new Date(st.mtimeMs).toISOString()]);
  }
  for (const t of await all("SELECT name, html FROM email_templates"))
    if (!files.some((f) => f.replace(/\.html?$/i, "") === t.name)) await fs.writeFile(path.join(dir, `${t.name}.html`), t.html);
}

export async function saveTemplate(name: string, html: string) {
  await run("INSERT INTO email_templates(id,name,html,updated_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET html=excluded.html, updated_at=excluded.updated_at",
    [newId(), name, html, now()]);
  if (filesAvailable()) {
    await fs.mkdir(absPath("Newsletter/Plantillas"), { recursive: true });
    await fs.writeFile(absPath(`Newsletter/Plantillas/${name}.html`), html);
  }
}
