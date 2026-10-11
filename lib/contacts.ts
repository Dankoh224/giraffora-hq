// Gobernanza de contactos: una sola base limpia, sin duplicados, con nicho, origen y estado de suscripción.
// Reglas: el email es la llave (en minúsculas); al importar se fusiona, nunca se pisa información;
// quien se dio de baja jamás se vuelve a suscribir por una importación.
import ExcelJS from "exceljs";
import { all, get, newId, now, run, setting } from "./db";

export type Niche = { id: string; name: string; desc: string; keywords: string };
export const DEFAULT_NICHES: Niche[] = [
  { id: "educacion", name: "Educación", desc: "Docentes, directivos, UTP, colegios y universidades", keywords: "educ,docente,profesor,colegio,escuela,liceo,utp,universidad,académ,academ,pedagog,párvul,parvul" },
  { id: "derecho", name: "Derecho", desc: "Abogados, estudios jurídicos, notarías", keywords: "derecho,abogad,legal,jurídic,juridic,notar,fiscal,tribunal" },
  { id: "terapeutas", name: "Terapeutas", desc: "Psicólogos, terapeutas, salud mental y salud", keywords: "terapeut,psicólog,psicolog,salud,clínic,clinic,fonoaudi,kinesi,coach" },
  { id: "empresa", name: "Empresa", desc: "Pymes, gerentes, RRHH, emprendedores", keywords: "empresa,pyme,gerent,rrhh,recursos humanos,emprend,negocio,comercial,ventas,corporat" },
];

export async function niches(): Promise<Niche[]> {
  try { const s = await setting("niches"); return s ? JSON.parse(s) : DEFAULT_NICHES; } catch { return DEFAULT_NICHES; }
}

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-z]{2,}$/i;
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function detectNiches(text: string, list: Niche[]) {
  const t = norm(text);
  return list.filter((n) => n.keywords.split(",").some((k) => k && t.includes(norm(k)))).map((n) => n.id);
}

// Lee CSV (coma o punto y coma) o Excel y devuelve filas como objetos con los encabezados originales.
export async function readTable(name: string, data: Buffer): Promise<Record<string, string>[]> {
  if (/\.xlsx$/i.test(name)) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as any);
    const rows: Record<string, string>[] = [];
    wb.eachSheet((ws) => {
      let header: string[] = [];
      ws.eachRow((row, i) => {
        const vals = (row.values as any[]).slice(1).map((v) => (v && typeof v === "object" ? v.text ?? v.result ?? v.hyperlink ?? "" : v ?? "").toString().trim());
        if (i === 1 || !header.length) { header = vals; return; }
        rows.push(Object.fromEntries(header.map((h, j) => [h || `col${j}`, vals[j] ?? ""])));
      });
    });
    return rows;
  }
  const text = data.toString("utf8").replace(/^﻿/, "");
  const sep = (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let cur: string[] = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
    else if (c === '"') q = true;
    else if (c === sep) { cur.push(field); field = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; cur.push(field); rows.push(cur); cur = []; field = ""; }
    else field += c;
  }
  if (field || cur.length) { cur.push(field); rows.push(cur); }
  const [header = [], ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return body.map((r) => Object.fromEntries(header.map((h, j) => [h.trim() || `col${j}`, (r[j] ?? "").trim()])));
}

const pick = (row: Record<string, string>, re: RegExp) => {
  const k = Object.keys(row).find((h) => re.test(norm(h)));
  return k ? row[k] : "";
};

export async function importContacts(rows: Record<string, string>[], source: string, forcedNiche?: string) {
  const list = await niches();
  const stats = { leidos: rows.length, nuevos: 0, fusionados: 0, sin_email: 0, invalidos: 0, dados_de_baja_respetados: 0 };
  for (const row of rows) {
    let email = pick(row, /e-?mail|correo|mail/) || Object.values(row).find((v) => EMAIL_RE.test(v.trim())) || "";
    email = email.trim().toLowerCase().replace(/^mailto:/, "");
    if (!email) { stats.sin_email++; continue; }
    if (!EMAIL_RE.test(email)) { stats.invalidos++; continue; }
    const first = pick(row, /^nombre|^name|first/), last = pick(row, /apellido|last/);
    const name = [first, last].filter(Boolean).join(" ").trim() || pick(row, /nombre|name/) || email.split("@")[0];
    const company = pick(row, /empresa|organiz|institu|colegio|compan|lugar de trabajo/);
    const phone = pick(row, /tel|fono|celular|whats|movil/);
    const role = pick(row, /cargo|profes|ocupac|rol|puesto/);
    const nicheText = [pick(row, /nicho|area|rubro|segment|categor|sector|interes/), role, company].join(" ");
    const found = forcedNiche ? [forcedNiche] : detectNiches(nicheText, list);

    const ex = await get("SELECT * FROM contacts WHERE lower(email)=?", [email]);
    if (ex) {
      const merged = [...new Set([...(ex.niches ? ex.niches.split(",") : []), ...found])].filter(Boolean).join(",");
      const sources = [...new Set([...(ex.source ? ex.source.split(" | ") : []), source])].join(" | ");
      await run(`UPDATE contacts SET name=coalesce(nullif(name,''),?), company=coalesce(nullif(company,''),?), phone=coalesce(nullif(phone,''),?),
        niches=?, source=?, updated_at=? WHERE id=?`, [name, company || null, phone || null, merged || null, sources, now(), ex.id]);
      stats.fusionados++;
      if (!ex.subscribed) stats.dados_de_baja_respetados++;
    } else {
      await run(`INSERT INTO contacts(id,name,type,company,email,phone,stage,notes,niches,subscribed,source,token,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?)`,
        [newId(), name, "suscriptor", company || null, email, phone || null, "nuevo", role || null, found.join(",") || null, source, newId() + newId(), now(), now()]);
      stats.nuevos++;
    }
  }
  return stats;
}

export async function audience(niche: string) {
  const where = "subscribed=1 AND bounced=0 AND email IS NOT NULL AND email!=''";
  return niche === "todos"
    ? all(`SELECT * FROM contacts WHERE ${where}`)
    : all(`SELECT * FROM contacts WHERE ${where} AND (',' || coalesce(niches,'') || ',') LIKE ?`, [`%,${niche},%`]);
}
