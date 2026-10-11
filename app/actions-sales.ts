"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { chileNow, get, newId, now, run } from "@/lib/db";
import { workOnTask } from "@/lib/engine";
import { filesAvailable } from "@/lib/files";
import { createTask, hireFromTemplate } from "@/lib/org";
import { templateById } from "@/lib/templates";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

async function ensureAgent(templateId: string) {
  const tpl = templateById(templateId)!;
  return (await get("SELECT * FROM agents WHERE template_id=? AND status='active' LIMIT 1", [templateId])) ?? (await hireFromTemplate(tpl.id));
}

export async function hireAgentAction(f: FormData) {
  await ensureAgent(s(f, "template_id"));
  revalidatePath("/", "layout");
}

// ── CRM ──
export async function saveDeal(f: FormData) {
  const id = s(f, "id");
  const note = s(f, "note");
  const vals = [s(f, "name"), s(f, "company") || null, s(f, "email").toLowerCase() || null, s(f, "phone") || null, s(f, "stage") || "nuevo",
    s(f, "deal_value") ? Number(s(f, "deal_value").replace(/\D/g, "")) : null, s(f, "next_action") || null, s(f, "next_action_date") || null];
  if (id) {
    const c = await get("SELECT notes FROM contacts WHERE id=?", [id]);
    await run(`UPDATE contacts SET name=?, company=?, email=?, phone=?, stage=?, deal_value=?, next_action=?, next_action_date=?, notes=?,
      last_contact_at=CASE WHEN ? THEN ? ELSE last_contact_at END, updated_at=? WHERE id=?`,
      [...vals, [c?.notes, note && `[${chileNow().date}] ${note}`].filter(Boolean).join("\n") || null, note ? 1 : 0, now(), now(), id]);
  } else {
    await run(`INSERT INTO contacts(id,name,company,email,phone,stage,deal_value,next_action,next_action_date,notes,type,source,token,last_contact_at,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,'prospecto','CRM',?,?,?,?)`,
      [newId(), ...vals, note ? `[${chileNow().date}] ${note}` : null, newId() + newId(), note ? now() : null, now(), now()]);
  }
  revalidatePath("/crm");
}

// ── Licitaciones ──
export async function searchTendersNow() {
  const g = await ensureAgent("cazador-licitaciones");
  const id = await createTask({ title: `Búsqueda de licitaciones ${chileNow().date}`, brief: templateById("cazador-licitaciones")!.routine!, agent_id: g.id, priority: 1 });
  if (filesAvailable()) void workOnTask(id).then(() => revalidatePath("/licitaciones")).catch(() => {});
  redirect(`/tareas/${id}`);
}

export async function tenderAction(f: FormData) {
  const t = await get("SELECT * FROM tenders WHERE id=?", [s(f, "id")]);
  if (!t) return;
  const action = s(f, "action");
  if (action === "offer") {
    const olivia = await ensureAgent("redactora-ofertas");
    const taskId = await createTask({
      title: `Oferta: ${t.name}`.slice(0, 110), agent_id: olivia.id, priority: 1,
      brief: `Prepara la oferta formal para esta licitación.\n\n- Código: ${t.code}\n- Nombre: ${t.name}\n- Organismo: ${t.buyer ?? "?"}\n- Monto: ${t.amount ?? "?"}\n- Cierre: ${t.close_date ?? "?"}\n- Ficha y bases: ${t.url ?? "(buscar por código en mercadopublico.cl)"}\n\n## Requisitos (evaluación de la Cazadora)\n${t.requirements ?? "-"}\n\n## ¿Podemos cumplir?: ${t.can_comply}\n${t.gaps ? `Brechas: ${t.gaps}` : ""}\n${t.notes ? `Notas: ${t.notes}` : ""}\n\n${s(f, "instruction") ? `Instrucción del CEO: ${s(f, "instruction")}` : ""}`,
    });
    await run("UPDATE tenders SET status='preparando_oferta', offer_task_id=?, updated_at=? WHERE id=?", [taskId, now(), t.id]);
    if (filesAvailable()) void workOnTask(taskId).catch(() => {});
    redirect(`/tareas/${taskId}`);
  }
  const status = { discard: "descartada", applied: "postulada", won: "ganada", lost: "perdida", reopen: "nueva" }[action];
  if (status) await run("UPDATE tenders SET status=?, updated_at=? WHERE id=?", [status, now(), t.id]);
  revalidatePath("/licitaciones");
}


export async function addTender(f: FormData) {
  const { createManualTender } = await import("@/lib/tenders");
  const code = s(f, "code") || `MANUAL-${chileNow().date}`;
  await createManualTender(code, s(f, "name") || code, s(f, "url") || null, s(f, "buyer") || null, s(f, "close_date") || null);
  revalidatePath("/licitaciones");
}

export async function reviewTender(f: FormData) {
  const t = await get("SELECT * FROM tenders WHERE id=?", [s(f, "id")]);
  if (!t) return;
  const g = await ensureAgent("cazador-licitaciones");
  const id = await createTask({
    title: `Revisar requisitos: ${t.name}`.slice(0, 110), agent_id: g.id, priority: 1,
    brief: `Lee TODOS los documentos de la licitación ${t.code} con tender_documents (bases técnicas, administrativas, anexos y formularios) y actualiza su evaluación con save_tender:\n- requisitos de admisibilidad y si Giraffora los cumple (si / parcial / no)\n- criterios de evaluación y ponderaciones\n- anexos y formularios que hay que entregar\n- garantías, plazos, presencialidad y documentos legales\nEntrega además una tabla "Requisito | ¿Cumplimos? | Evidencia o brecha" y la lista de anexos a preparar.`,
  });
  if (filesAvailable()) void workOnTask(id).catch(() => {});
  redirect(`/tareas/${id}`);
}
