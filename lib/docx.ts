// Convierte una entrega en Markdown a Word usando una plantilla .docx de Giraffora.
// Plantillas en Archivos/Plantillas/Word/*.docx. En la plantilla escribe (cada uno en un solo intento,
// sin cambiar el formato a la mitad): {{contenido}} en el párrafo donde va el texto, y opcionalmente
// {{titulo}}, {{fecha}} y {{cliente}} en portada o encabezados. Se usan los estilos de la plantilla
// (Título 1/2/3, Viñeta, Normal), así el documento sale con la imagen de Giraffora.
import JSZip from "jszip";
import fs from "node:fs/promises";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Texto con **negrita** y *cursiva* → runs de Word.
function runs(text: string, base = "") {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean).map((part) => {
    const bold = /^\*\*.*\*\*$/.test(part), italic = !bold && /^\*.*\*$/.test(part);
    const t = bold ? part.slice(2, -2) : italic ? part.slice(1, -1) : part;
    const rpr = base + (bold ? "<w:b/>" : "") + (italic ? "<w:i/>" : "");
    return `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
  }).join("");
}

function styleMap(stylesXml: string) {
  const map: Record<string, string> = {};
  for (const m of stylesXml.matchAll(/<w:style\b[^>]*w:type="paragraph"[^>]*w:styleId="([^"]+)"[^>]*>[\s\S]*?<w:name w:val="([^"]+)"/g))
    map[m[2].toLowerCase()] = m[1];
  return map;
}

function markdownToXml(md: string, st: Record<string, string>) {
  const para = (text: string, style?: string, base = "") =>
    `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${runs(text, base)}</w:p>`;
  const out: string[] = [];
  const lines = md.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (!line.trim() || /^---+$/.test(line.trim())) continue;
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const style = st[`heading ${h[1].length}`];
      out.push(style ? para(h[2], style) : para(h[2], undefined, `<w:b/><w:sz w:val="${36 - h[1].length * 4}"/>`));
      continue;
    }
    if (/^\|.*\|$/.test(line.trim())) { // tabla
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        if (!/^\|[\s:|-]+\|$/.test(lines[i].trim())) rows.push(lines[i].trim().slice(1, -1).split("|").map((c) => c.trim()));
        i++;
      }
      i--;
      const border = `<w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => `<w:${b} w:val="single" w:sz="4" w:color="999999"/>`).join("")}</w:tblBorders>`;
      out.push(`<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>${border}</w:tblPr>${rows.map((r, ri) =>
        `<w:tr>${r.map((c) => `<w:tc><w:p>${runs(c, ri === 0 ? "<w:b/>" : "")}</w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`, "<w:p/>");
      continue;
    }
    const li = line.match(/^\s*[-*•]\s+(.*)$/);
    if (li) { out.push(st["list bullet"] ? para(li[1], st["list bullet"]) : para(`• ${li[1]}`)); continue; }
    const ol = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (ol) { out.push(st["list number"] ? para(ol[2], st["list number"]) : para(`${ol[1]}. ${ol[2]}`)); continue; }
    out.push(para(line.replace(/^>\s?/, "")));
  }
  return out.join("");
}

// Reemplaza marcadores {{x}} aunque Word los haya partido en varios "runs".
function fillPlaceholders(xml: string, values: Record<string, string>) {
  return xml.replace(/<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?\{\{(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, (p) => {
    const text = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    if (!/\{\{\s*\w+\s*\}\}/.test(text) || /\{\{\s*contenido\s*\}\}/.test(text)) return p;
    const filled = text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k) => esc(values[k] ?? ""));
    const ppr = p.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0] ?? "";
    const rpr = p.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] ?? "";
    return `<w:p>${ppr}<w:r>${rpr}<w:t xml:space="preserve">${filled}</w:t></w:r></w:p>`;
  });
}

export async function markdownToDocx(md: string, templatePath: string | null, values: Record<string, string>) {
  const zip = templatePath ? await JSZip.loadAsync(await fs.readFile(templatePath)) : blankDocx();
  const docXml = await zip.file("word/document.xml")!.async("string");
  const st = styleMap((await zip.file("word/styles.xml")?.async("string")) ?? "");
  const body = markdownToXml(md, st);
  let xml = fillPlaceholders(docXml, values);
  const holder = /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?\{\{(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g;
  let placed = false;
  xml = xml.replace(holder, (p) => {
    const text = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join("");
    if (!placed && /\{\{\s*contenido\s*\}\}/.test(text)) { placed = true; return body; }
    return p;
  });
  if (!placed) { // plantilla sin {{contenido}}: el texto va al final del cuerpo
    const i = xml.lastIndexOf("<w:sectPr");
    xml = i > 0 ? xml.slice(0, i) + body + xml.slice(i) : xml.replace("</w:body>", `${body}</w:body>`);
  }
  zip.file("word/document.xml", xml);
  return zip.generateAsync({ type: "nodebuffer" });
}

// Documento base si aún no hay plantilla de Giraffora.
function blankDocx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  const h = (n: number, sz: number) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:rPr><w:b/><w:color w:val="B86E12"/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:lang w:val="es-CL"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${h(1, 32)}${h(2, 28)}${h(3, 24)}<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:style></w:styles>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>{{titulo}}</w:t></w:r></w:p><w:p><w:r><w:t>Giraffora · {{fecha}}</w:t></w:r></w:p><w:p><w:r><w:t>{{contenido}}</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip;
}
