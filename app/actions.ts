"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { newId, now, run, get, setSetting } from "@/lib/db";
import { morningBrief, shift, workOnTask } from "@/lib/engine";
import { createTask, ensureArea, hireCustom, hireFromTemplate } from "@/lib/org";
import { authToken } from "@/lib/auth";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function createMission(f: FormData) {
  const id = await createTask({
    title: s(f, "title") || s(f, "brief").slice(0, 70) || "Nueva misión",
    brief: s(f, "brief"), agent_id: s(f, "agent_id") || "jefa-gabinete", priority: Number(s(f, "priority") || 2),
  });
  if (s(f, "now") === "1") await workOnTask(id);
  revalidatePath("/", "layout");
  redirect(`/tareas/${id}`);
}

export async function workNow(f: FormData) {
  await workOnTask(s(f, "task_id"));
  revalidatePath("/", "layout");
}

export async function reviewTask(f: FormData) {
  const taskId = s(f, "task_id");
  const decision = s(f, "decision"); // approve | changes | archive | redo
  const body = s(f, "body");
  if (body || decision !== "redo") {
    await run("INSERT INTO feedback(id,task_id,decision,body,created_at) VALUES(?,?,?,?,?)", [newId(), taskId, decision, body, now()]);
  }
  const status = decision === "approve" ? "done" : decision === "archive" ? "archived" : "changes";
  await run("UPDATE tasks SET status=?, updated_at=? WHERE id=?", [status, now(), taskId]);
  if (decision === "redo") await workOnTask(taskId);
  revalidatePath("/", "layout");
}

export async function reassignTask(f: FormData) {
  await run("UPDATE tasks SET agent_id=?, status=CASE WHEN status='review' THEN 'changes' ELSE status END, updated_at=? WHERE id=?",
    [s(f, "agent_id"), now(), s(f, "task_id")]);
  revalidatePath("/", "layout");
}

export async function hireTemplate(f: FormData) {
  const a = await hireFromTemplate(s(f, "template_id"), s(f, "name") || undefined);
  revalidatePath("/", "layout");
  redirect(`/agentes/${a.id}`);
}

export async function hireCustomAction(f: FormData) {
  const a = await hireCustom({
    area: s(f, "area"), name: s(f, "name"), role: s(f, "role"), rank: s(f, "rank"), emoji: s(f, "emoji"),
    skills: f.getAll("skills").map(String), prompt: s(f, "prompt"), routine: s(f, "routine") || null,
    routine_hour: s(f, "routine_hour") ? Number(s(f, "routine_hour")) : null, model: s(f, "model") || null, runner: s(f, "runner"),
  });
  revalidatePath("/", "layout");
  redirect(`/agentes/${a.id}`);
}

export async function updateAgent(f: FormData) {
  const id = s(f, "id");
  await run(
    `UPDATE agents SET name=?, role=?, rank=?, emoji=?, area_id=?, skills=?, system_prompt=?, routine=?, routine_hour=?, model=?, status=?, runner=? WHERE id=?`,
    [s(f, "name"), s(f, "role"), s(f, "rank"), s(f, "emoji"), s(f, "area_id"), JSON.stringify(f.getAll("skills").map(String)),
     s(f, "prompt"), s(f, "routine") || null, s(f, "routine_hour") ? Number(s(f, "routine_hour")) : null, s(f, "model") || null, s(f, "status") || "active", s(f, "runner") === "claude-code" ? "claude-code" : "cloud", id],
  );
  revalidatePath("/", "layout");
}

export async function createArea(f: FormData) {
  await ensureArea(s(f, "name"), s(f, "description"), s(f, "emoji") || "🏢");
  revalidatePath("/equipo");
}

export async function outboxDecision(f: FormData) {
  const id = s(f, "id");
  const decision = s(f, "decision");
  const item = await get("SELECT * FROM outbox WHERE id=?", [id]);
  if (!item) return;
  const body = s(f, "body") || item.body;
  if (decision !== "reject" && item.channel === "email") {
    // Los correos salen directo desde tu cuenta (SMTP), sin n8n.
    await run("UPDATE outbox SET body=?, status='approved', decided_at=? WHERE id=?", [body, now(), id]);
    const { sendOutboxEmail, accounts } = await import("@/lib/mail");
    if (accounts().length) await sendOutboxEmail(id).catch(() => {});
    revalidatePath("/", "layout");
    return;
  }
  let status = decision === "reject" ? "rejected" : "approved";
  if (status === "approved" && process.env.N8N_OUTBOX_WEBHOOK) {
    const r = await fetch(process.env.N8N_OUTBOX_WEBHOOK, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, body }),
    }).catch(() => null);
    if (r?.ok) status = "sent";
  }
  await run("UPDATE outbox SET status=?, body=?, decided_at=? WHERE id=?", [status, body, now(), id]);
  revalidatePath("/", "layout");
}

export async function addTodo(f: FormData) {
  const text = s(f, "text");
  if (text) await run("INSERT INTO todos(id,text,due,created_at) VALUES(?,?,?,?)", [newId(), text, s(f, "due") || null, now()]);
  revalidatePath("/");
}

export async function toggleTodo(f: FormData) {
  await run("UPDATE todos SET done=1-done, done_at=? WHERE id=?", [now(), s(f, "id")]);
  revalidatePath("/");
}

export async function addEvent(f: FormData) {
  await run("INSERT INTO events(id,source,kind,from_name,category,title,body,occurred_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
    [newId(), s(f, "source") || "manual", "nota", s(f, "from_name"), s(f, "category") || "sin_clasificar", s(f, "title"), s(f, "body"),
     s(f, "occurred_at") ? new Date(s(f, "occurred_at")).toISOString() : now(), now()]);
  revalidatePath("/datos");
}

export async function saveCompany(f: FormData) {
  await setSetting("company", s(f, "company"));
  revalidatePath("/ajustes");
}

export async function runShiftNow() {
  await shift({ maxTasks: 3 });
  revalidatePath("/", "layout");
}

export async function newBrief() {
  await morningBrief();
  revalidatePath("/");
}

export async function login(f: FormData) {
  if (process.env.APP_PASSWORD && s(f, "password") === process.env.APP_PASSWORD) {
    (await cookies()).set("ev_auth", await authToken(process.env.APP_PASSWORD), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 60 * 60 * 24 * 60, path: "/" });
    redirect("/");
  }
  redirect("/login?e=1");
}

// ── Archivos ──
export async function saveTextFile(f: FormData) {
  const { absPath, syncFiles } = await import("@/lib/files");
  const fs = await import("node:fs/promises");
  await fs.writeFile(absPath(s(f, "p")), String(f.get("content") ?? ""));
  await syncFiles(); // si es entrega.md, queda como nueva versión "editada por ti"
  revalidatePath("/", "layout");
}

export async function deleteEntry(f: FormData) {
  const { removeEntry } = await import("@/lib/files");
  await removeEntry(s(f, "p"));
  revalidatePath("/archivos");
  redirect(`/archivos?p=${encodeURIComponent(s(f, "back"))}`);
}

export async function makeFolder(f: FormData) {
  const { absPath } = await import("@/lib/files");
  const fs = await import("node:fs/promises");
  const name = s(f, "name").replace(/[<>:"/\|?*]/g, "");
  if (name) await fs.mkdir(absPath(`${s(f, "p")}/${name}`), { recursive: true });
  revalidatePath("/archivos");
}

export async function openInExplorer(f: FormData) {
  const { absPath, filesAvailable } = await import("@/lib/files");
  if (!filesAvailable() || process.platform !== "win32") return;
  const { spawn } = await import("node:child_process");
  const fs = await import("node:fs/promises");
  const target = absPath(s(f, "p"));
  const st = await fs.stat(target).catch(() => null);
  spawn("explorer.exe", st?.isFile() ? [`/select,${target}`] : [target], { detached: true, stdio: "ignore" }).unref();
}

export async function dismissNotice(f: FormData) {
  await run("UPDATE notices SET status='done', done_at=? WHERE id=?", [now(), s(f, "id")]);
  revalidatePath("/");
}
