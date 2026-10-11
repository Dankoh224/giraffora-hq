import type { Client } from "@libsql/client";
import { areaTemplate, templateById } from "./templates";

const COMPANY = `Giraffora es una empresa chilena de inteligencia artificial. Líneas de negocio:
- Cursos y talleres de IA (personas, docentes, colegios, pymes, empresas, municipios).
- Desarrollos de software e IA a medida (incluye visión por computador, p.ej. un MVP de cámaras para prevenir accidentes infantiles).
- Automatizaciones para empresas (n8n, agentes de IA).
El CEO dirige la empresa apoyado por un equipo de agentes de IA. Tono: cercano, experto, optimista y práctico. Mercado principal: Chile.`;

// La empresa parte pequeña: Dirección + Oficina del CEO. El resto se contrata desde la app.
export async function seed(c: Client) {
  const ts = new Date().toISOString();
  await c.execute({ sql: "INSERT OR IGNORE INTO settings(key,value) VALUES('company',?)", args: [COMPANY] });
  for (const areaId of ["direccion", "oficina-ceo"]) {
    const a = areaTemplate(areaId)!;
    await c.execute({ sql: "INSERT INTO areas(id,name,description,emoji,created_at) VALUES(?,?,?,?,?)", args: [a.id, a.name, a.description, a.emoji, ts] });
  }
  for (const tid of ["jefa-gabinete", "asistente-matinal"]) {
    const t = templateById(tid)!;
    await c.execute({
      sql: `INSERT INTO agents(id,area_id,template_id,name,role,rank,emoji,skills,system_prompt,routine,routine_hour,created_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [t.id, t.area, t.id, t.name, t.role, t.rank, t.emoji, JSON.stringify(t.skills), t.prompt, t.routine ?? null, t.routine_hour ?? null, ts],
    });
  }
}
