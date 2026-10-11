"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { get, now, run, setSetting } from "@/lib/db";
import { draftReply, mailCycle, sendOutboxEmail } from "@/lib/mail";
import { importContacts, readTable } from "@/lib/contacts";
import { createCampaign, saveConfig, sendCampaigns, sendTest, weeklyDrafts } from "@/lib/newsletter";
import { createTask } from "@/lib/org";
import { filesAvailable } from "@/lib/files";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// ── Correo ──
export async function checkMailNow() {
  await mailCycle();
  revalidatePath("/", "layout");
}

export async function emailDecision(f: FormData) {
  const id = s(f, "id"), decision = s(f, "decision"), instruction = s(f, "instruction");
  if (decision === "ignore") await run("UPDATE emails SET status='ignorado' WHERE id=?", [id]);
  if (decision === "done") await run("UPDATE emails SET status='archivado' WHERE id=?", [id]);
  if (decision === "reopen") await run("UPDATE emails SET status='nuevo' WHERE id=?", [id]);
  if (decision === "reply") await draftReply(id, instruction || "Responde de forma cordial y breve.");
  if (decision === "task") {
    const e = await get("SELECT * FROM emails WHERE id=?", [id]);
    if (e) {
      const t = await createTask({
        title: `Correo de ${e.from_name ?? e.from_email}: ${e.subject}`.slice(0, 110),
        brief: `${instruction || "Encárgate de este correo."}\n\n---\nCorreo (${e.account}) de ${e.from_name ?? ""} <${e.from_email}>\nAsunto: ${e.subject}\n\n${String(e.body).slice(0, 5000)}`,
        agent_id: "jefa-gabinete", priority: (e.importance ?? 3) >= 4 ? 1 : 2,
      });
      await run("UPDATE emails SET status='archivado', instruction=? WHERE id=?", [`→ tarea ${t}`, id]);
    }
  }
  revalidatePath("/correo");
}

export async function sendDraft(f: FormData) {
  const id = s(f, "outbox_id");
  if (s(f, "decision") === "discard") {
    const o = await get("SELECT email_id FROM outbox WHERE id=?", [id]);
    await run("UPDATE outbox SET status='rejected', decided_at=? WHERE id=?", [now(), id]);
    if (o?.email_id) await run("UPDATE emails SET status='nuevo' WHERE id=?", [o.email_id]);
  } else {
    await run("UPDATE outbox SET body=?, status='approved', decided_at=? WHERE id=?", [String(f.get("body") ?? ""), now(), id]);
    await sendOutboxEmail(id);
  }
  revalidatePath("/", "layout");
}

// ── Contactos ──
export async function importContactsAction(f: FormData) {
  const file = f.get("file") as File | null;
  if (!file || !file.size) redirect("/contactos?msg=" + encodeURIComponent("Elige un archivo CSV o Excel"));
  const rows = await readTable(file!.name, Buffer.from(await file!.arrayBuffer()));
  const stats = await importContacts(rows, s(f, "source") || file!.name, s(f, "niche") || undefined);
  revalidatePath("/contactos");
  redirect("/contactos?msg=" + encodeURIComponent(
    `${file!.name}: ${stats.leidos} filas · ${stats.nuevos} nuevos · ${stats.fusionados} ya existían (fusionados) · ${stats.invalidos} correos inválidos · ${stats.sin_email} sin correo`));
}

export async function updateContact(f: FormData) {
  const id = s(f, "id");
  if (f.has("niches")) await run("UPDATE contacts SET niches=?, updated_at=? WHERE id=?", [f.getAll("niches").map(String).join(",") || null, now(), id]);
  if (s(f, "subscribed") === "0") await run("UPDATE contacts SET subscribed=0, unsubscribed_at=? WHERE id=?", [now(), id]);
  if (s(f, "subscribed") === "1") await run("UPDATE contacts SET subscribed=1, unsubscribed_at=NULL WHERE id=?", [id]);
  revalidatePath("/contactos");
}

export async function saveNiches(f: FormData) {
  const list = s(f, "niches").split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0])
    .map(([id, name, desc, keywords]) => ({ id: id.toLowerCase(), name: name || id, desc: desc || "", keywords: keywords || id }));
  await setSetting("niches", JSON.stringify(list));
  revalidatePath("/contactos");
  revalidatePath("/newsletter");
}

// ── Newsletter ──
export async function saveNewsletter(f: FormData) {
  await saveConfig({
    active: s(f, "active") === "1", auto_send: s(f, "auto_send") === "1",
    day: Number(s(f, "day") || 2), hour: Number(s(f, "hour") || 9), instruction: s(f, "instruction"),
  });
  revalidatePath("/newsletter");
}

export async function draftWeeklyNow() {
  await weeklyDrafts(() => {}, true);
  revalidatePath("/newsletter");
}

export async function newCampaign(f: FormData) {
  const id = await createCampaign({ title: s(f, "title") || "Nuevo envío", subject: s(f, "subject") || "(asunto)", body: s(f, "body") || "Hola {{nombre}},\n\n", niche: s(f, "niche") || "todos" });
  redirect(`/newsletter/${id}`);
}

export async function campaignAction(f: FormData) {
  const id = s(f, "id"), action = s(f, "action");
  if (["save", "approve"].includes(action))
    await run("UPDATE campaigns SET title=?, subject=?, body=?, niche=?, template=? WHERE id=? AND status IN ('borrador','aprobada')",
      [s(f, "title"), s(f, "subject"), String(f.get("body") ?? ""), s(f, "niche"), s(f, "template") || null, id]);
  if (action === "approve") {
    await run("UPDATE campaigns SET status='aprobada', approved_at=? WHERE id=?", [now(), id]);
    // En tu PC empieza a enviar de inmediato (en segundo plano); en la nube lo toma el próximo turno.
    if (filesAvailable()) void sendCampaigns(console.log).catch(console.error);
  }
  if (action === "unapprove") await run("UPDATE campaigns SET status='borrador' WHERE id=? AND status='aprobada'", [id]);
  if (action === "test") await sendTest(id);
  if (action === "delete") { await run("DELETE FROM campaigns WHERE id=? AND status IN ('borrador','aprobada')", [id]); redirect("/newsletter"); }
  revalidatePath("/newsletter");
  revalidatePath(`/newsletter/${id}`);
}

export async function saveTemplateAction(f: FormData) {
  const { saveTemplate } = await import("@/lib/subscribers");
  const file = f.get("file") as File | null;
  const html = file && file.size ? await file.text() : String(f.get("html") ?? "");
  const name = s(f, "name") || (file?.name ?? "").replace(/\.html?$/i, "") || "Plantilla";
  if (html.trim()) await saveTemplate(name, html);
  revalidatePath("/newsletter");
}

export async function setDefaultTemplate(f: FormData) {
  await setSetting("newsletter_template", s(f, "template"));
  revalidatePath("/newsletter");
}
