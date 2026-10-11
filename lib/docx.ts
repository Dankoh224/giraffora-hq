// Convierte una entrega en Markdown a Word con la plantilla de Giraffora (Archivos/Plantillas/Word).
// La plantilla es un documento real de Giraffora: se conserva su portada (logo, marca, lema), encabezado,
// pie y bordes, y el contenido se arma CLONANDO los formatos que trae: título de sección ("1. …"),
// subtítulo ("4.1. …"), párrafo, viñeta y tabla. Así todos los documentos salen con la misma imagen.
//
// Datos de portada: la entrega puede empezar con un bloque así (opcional):
//   ---
//   tipo: PROPUESTA TÉCNICA Y COMERCIAL
//   cliente: Municipalidad de La Pintana · Programa Familia
//   destinatario: A Lorena Calderón, Asistente Social
//   ---
//   # Título del documento
import JSZip from "jszip";
import fs from "node:fs/promises";

export type DocMeta = { tipo?: string; titulo?: string; cliente?: string; destinatario?: string; fecha?: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const textOf = (xml: string) => [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
const rPrOf = (run: string) => run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
const pPrOf = (p: string) => p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
const runsOf = (p: string) => p.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g) ?? [];
const textRun = (p: string, bold?: boolean) => runsOf(p).find((r) => /<w:t[\s>]/.test(r) && textOf(r).trim() && (bold === undefined || /<w:b\/>/.test(r) === bold));
const noBold = (rpr: string) => rpr.replace(/<w:b\/>|<w:bCs\/>/g, "");
const withBold = (rpr: string) => (/<w:b\/>/.test(rpr) ? rpr : rpr.replace("<w:rPr>", "<w:rPr><w:b/><w:bCs/>"));

// Separa el bloque de portada (--- … ---) y el primer "# Título".
export function splitMeta(md: string): { meta: DocMeta; body: string } {
  const meta: DocMeta = {};
  let body = md.replace(/\r/g, "").trim();
  const fm = body.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^\s*(tipo|cliente|destinatario|fecha|titulo|título)\s*:\s*(.+)$/i);
      if (m) (meta as any)[m[1].toLowerCase().replace("título", "titulo")] = m[2].trim();
    }
    body = body.slice(fm[0].length).trim();
  }
  const h = body.match(/^#\s+(.+)$/m);
  if (h && !meta.titulo) meta.titulo = h[1].replace(/[*#]/g, "").trim();
  if (h) body = body.replace(h[0], "").trim();
  return { meta, body };
}

// ── Formatos clonados de la plantilla ──
type Protos = { h1?: string; h2?: string; body?: string; bullet?: string; table?: string };

function findProtos(blocks: string[]): Protos {
  const p: Protos = {};
  for (const b of blocks) {
    if (b.startsWith("<w:tbl>")) { p.table ??= b; continue; }
    const t = textOf(b).trim();
    if (!p.h1 && /^\d+\.\s/.test(t) && !/^\d+\.\d/.test(t) && /<w:b\/>/.test(b)) p.h1 = b;
    else if (!p.h2 && /w:pStyle w:val="[^"]*(2|Heading2)"/.test(b)) p.h2 = b;
    else if (!p.bullet && /<w:numPr>/.test(b)) p.bullet = b;
    else if (!p.body && p.h1 && t.length > 80 && !/<w:numPr>/.test(b) && !/w:pStyle/.test(b)) p.body = b;
  }
  return p;
}

function inline(text: string, rpr: string, boldRpr: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => {
    const b = /^\*\*.*\*\*$/.test(part);
    const t = (b ? part.slice(2, -2) : part).replace(/\*([^*]+)\*/g, "$1").replace(/`([^`]+)`/g, "$1");
    return `<w:r>${b ? boldRpr : rpr}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  }).join("");
}

function builders(p: Protos) {
  const para = (proto: string | undefined, text: string, forceBold = false) => {
    const ppr = proto ? pPrOf(proto) : "";
    const run = (proto && (textRun(proto, false) ?? textRun(proto))) || "";
    const base = rPrOf(run);
    const bold = proto ? rPrOf(textRun(proto, true) ?? "") || withBold(base) : "<w:rPr><w:b/></w:rPr>";
    return `<w:p>${ppr}${inline(text, forceBold ? withBold(base) : noBold(base), bold)}</w:p>`;
  };
  const table = (rows: string[][]) => {
    const proto = p.table;
    const n = Math.max(...rows.map((r) => r.length));
    const grid = `<w:tblGrid>${Array.from({ length: n }, () => `<w:gridCol w:w="${Math.floor(9360 / n)}"/>`).join("")}</w:tblGrid>`;
    if (!proto) {
      const border = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((x) => `<w:${x} w:val="single" w:sz="4" w:color="999999"/>`).join("")}</w:tblBorders>`;
      return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${border}</w:tblPr>${grid}${rows.map((r, i) => `<w:tr>${r.map((c) => `<w:tc><w:p>${inline(c, i ? "" : "<w:rPr><w:b/></w:rPr>", "<w:rPr><w:b/></w:rPr>")}</w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
    }
    const tblPr = proto.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/)?.[0] ?? "";
    const protoRows = proto.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
    const cellParts = (row: string | undefined) => {
      const tc = row?.match(/<w:tc>[\s\S]*?<\/w:tc>/)?.[0] ?? "";
      const tcPr = (tc.match(/<w:tcPr>[\s\S]*?<\/w:tcPr>/)?.[0] ?? "<w:tcPr></w:tcPr>").replace(/<w:tcW [^>]*\/>/, "");
      const pp = tc.match(/<w:p\b[\s\S]*?<\/w:p>/)?.[0] ?? "";
      return { tcPr, pPr: pPrOf(pp), rPr: rPrOf(textRun(pp) ?? runsOf(pp)[0] ?? "") };
    };
    const head = cellParts(protoRows[0]), data = cellParts(protoRows[1] ?? protoRows[0]);
    const w = Math.floor(5000 / n);
    const tr = (cells: string[], c: typeof head, isHead: boolean) =>
      `<w:tr>${isHead ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${cells.map((txt) =>
        `<w:tc>${c.tcPr.replace("<w:tcPr>", `<w:tcPr><w:tcW w:w="${w}" w:type="pct"/>`)}<w:p>${c.pPr}${inline(txt, c.rPr, withBold(c.rPr))}</w:p></w:tc>`).join("")}</w:tr>`;
    return `<w:tbl>${tblPr}${grid}${rows.map((r, i) => tr([...r, ...Array(n - r.length).fill("")], i === 0 ? head : data, i === 0)).join("")}</w:tbl>`;
  };
  return { para, table };
}

function markdownToBody(md: string, p: Protos) {
  const { para, table } = builders(p);
  const out: string[] = [];
  const blank = "<w:p/>";
  let firstH1 = true;
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim() || /^---+$/.test(line.trim())) continue;
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const text = h[2].replace(/\*\*/g, "");
      if (h[1].length <= 2) { // sección principal: "1. Antecedentes"
        if (!firstH1) out.push(blank, blank);
        firstH1 = false;
        out.push(para(p.h1, text, true), blank);
      } else out.push(para(p.h2 ?? p.h1, text, true));
      continue;
    }
    if (/^\|.*\|$/.test(line.trim())) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        if (!/^\|[\s:|-]+\|$/.test(lines[i].trim())) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      i--;
      out.push(table(rows), blank);
      continue;
    }
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) { out.push(para(p.bullet ?? p.body, li[1])); continue; }
    out.push(para(p.body, line.replace(/^>\s?/, "")));
  }
  return out.join("");
}

// Portada: reemplaza tipo, título, cliente, destinatario y fecha manteniendo el diseño.
function fillCover(cover: string[], meta: DocMeta) {
  const sig = (r: string) => `${r.match(/<w:sz w:val="(\d+)"/)?.[1] ?? ""}|${r.match(/<w:color w:val="(\w+)"/)?.[1] ?? ""}`;
  const setRuns = (p: string, pick: (r: string) => boolean, value: string, dropBreaksAfter = false) => {
    let used = false, after = false;
    return p.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, (r) => {
      const hasText = /<w:t[\s>]/.test(r) && textOf(r).length > 0;
      if (hasText && pick(r)) {
        after = true;
        if (used) return "";
        used = true;
        return r.replace(/<w:t(\s[^>]*)?>[^<]*<\/w:t>/, `<w:t xml:space="preserve">${esc(value)}</w:t>`).replace(/(<w:t[^>]*>[^<]*<\/w:t>)[\s\S]*?(?=<\/w:r>)/, "$1");
      }
      if (dropBreaksAfter && after && !hasText && pick(r)) return "";
      return r;
    });
  };
  return cover.map((b) => {
    const t = textOf(b);
    if (/PROPUESTA|INFORME|DOCUMENTO/i.test(t) && /<w:sz w:val="56"/.test(b)) {
      let out = setRuns(b, (r) => sig(r).startsWith("30|"), (meta.tipo ?? "DOCUMENTO").toUpperCase());
      out = setRuns(out, (r) => sig(r).startsWith("56|"), meta.titulo ?? "", true);
      return out;
    }
    if (/Presentado a:/.test(t)) return meta.cliente ? b : setRuns(b, () => true, "");
    if (/<w:b\/>[\s\S]*?<w:color w:val="222222"/.test(b)) {
      let out = setRuns(b, (r) => /<w:b\/>/.test(r) && sig(r).endsWith("|222222"), meta.cliente ?? "");
      out = setRuns(out, (r) => sig(r) === "18|666666", meta.destinatario ?? "");
      out = setRuns(out, (r) => sig(r) === "22|999999", meta.fecha ?? "");
      return out;
    }
    return b;
  });
}

export async function markdownToDocx(md: string, templatePath: string | null, values: DocMeta) {
  const { meta: m, body } = splitMeta(md);
  const meta: DocMeta = { ...values, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v)) };
  const zip = templatePath ? await JSZip.loadAsync(await fs.readFile(templatePath)) : blankDocx();
  const docXml = await zip.file("word/document.xml")!.async("string");
  const start = docXml.indexOf("<w:body>") + 8;
  const sectAt = docXml.lastIndexOf("<w:sectPr");
  const inner = docXml.slice(start, sectAt);
  const blocks: string[] = inner.match(/<w:p\b[^>]*\/>|<w:p\b[\s\S]*?<\/w:p>|<w:tbl>[\s\S]*?<\/w:tbl>|<w:sdt>[\s\S]*?<\/w:sdt>/g) ?? [];
  const protos = findProtos(blocks);
  // Todo lo anterior al primer título de sección es la portada.
  const firstSection = protos.h1 ? blocks.indexOf(protos.h1) : -1;
  const cover = firstSection > 0 ? fillCover(blocks.slice(0, firstSection), meta) : [];
  // Quitar los párrafos vacíos del final de la portada y saltar de página de forma explícita.
  while (cover.length && !textOf(cover[cover.length - 1]).trim() && !/<w:drawing|<w:pict/.test(cover[cover.length - 1])) cover.pop();
  if (cover.length) cover.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
  const content = markdownToBody(body, protos);
  // Cierre/firma de la plantilla (logo, lema, nombre y contacto): desde el último bloque con imagen
  // después del contenido hasta el final. Se conserva tal cual, en su propia página.
  let closing: string[] = [];
  for (let i = blocks.length - 1; i > firstSection && i >= blocks.length - 8; i--) {
    if (/<w:drawing|<w:pict/.test(blocks[i])) { closing = blocks.slice(i); break; }
  }
  const signature = closing.length ? `<w:p><w:r><w:br w:type="page"/></w:r></w:p>${closing.join("")}` : "";
  const xml = docXml.slice(0, start) + cover.join("") + content + signature + docXml.slice(sectAt);
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// Documento base si aún no hay plantilla de Giraffora.
function blankDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>1. Documento</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip;
}

// Flujo de los agentes: 1) se copia la plantilla de Giraffora a la carpeta de la tarea,
// 2) se abre ESA copia y se rellena (portada + contenido). Todo lo demás del archivo —estilos,
// tema, numeración, encabezado, pie, márgenes, imágenes— queda tal cual viene en tu plantilla.
export async function fillTemplateCopy(templatePath: string | null, destPath: string, md: string, values: DocMeta) {
  if (templatePath) await fs.copyFile(templatePath, destPath);
  const buf = await markdownToDocx(md, templatePath ? destPath : null, values);
  await fs.writeFile(destPath, buf);
  return destPath;
}
