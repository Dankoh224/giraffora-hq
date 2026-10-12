import Link from "next/link";
import { all, chileNow, get } from "@/lib/db";
import { availableProviders } from "@/lib/llm";
import { LEVEL, priorities } from "@/lib/priorities";
import { Chat } from "@/components/Chat";
import { Markdown } from "@/components/Markdown";
import { Submit } from "@/components/Submit";
import { SpacesNav } from "@/components/SpacesNav";
import { warmAgent } from "@/lib/engine";
import { addTodo, dismissNotice, newBrief, runShiftNow, toggleTodo } from "./actions";
import { TaskMenu } from "@/components/TaskMenu";
import type { Priority } from "@/lib/priorities";

const LVL_CLASS = { 1: "b-changes", 2: "b-review", 3: "" } as const;

// Un ítem compacto de la lista de enfoque: ícono, texto (enlace) y acciones.
function FocusItem({ p }: { p: Priority }) {
  return (
    <li className={`lvl${p.level}`}>
      <span>{p.icon}</span>
      <Link href={p.link} title={LEVEL[p.level]}>{p.text}</Link>
      {p.noticeId
        ? <form action={dismissNotice}><input type="hidden" name="id" value={p.noticeId} /><button className="btn sm" title="Hecho">✓</button></form>
        : p.taskId ? <TaskMenu id={p.taskId} /> : null}
    </li>
  );
}

export default async function Home() {
  const { date, hour } = chileNow();
  const greet = hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";
  const list = await priorities();
  const brief = await get("SELECT * FROM briefs ORDER BY created_at DESC LIMIT 1");
  const since = new Date(Date.now() - 24 * 3600e3).toISOString();
  const night = await all("SELECT r.status, t.id AS task_id, t.title, a.name, a.emoji FROM runs r LEFT JOIN tasks t ON t.id=r.task_id LEFT JOIN agents a ON a.id=r.agent_id WHERE r.started_at>=? ORDER BY r.started_at DESC LIMIT 10", [since]);
  const todos = await all("SELECT * FROM todos WHERE done=0 OR done_at>=? ORDER BY done, coalesce(due,'9999'), created_at", [since]);
  const msgs = (await all("SELECT role, content, meta FROM messages WHERE agent_id='jefa-gabinete' ORDER BY created_at DESC LIMIT 20")).reverse()
    .map((m) => ({ role: m.role, content: m.content, tools: m.meta ? JSON.parse(m.meta).tools : undefined }));
  const team = await get<{ n: number }>("SELECT COUNT(*) AS n FROM agents WHERE status='active'");
  const noBrain = availableProviders().length === 0;
  void warmAgent("jefa-gabinete"); // despierta a Clara en segundo plano para que responda rápido

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{greet}, Danko 🦒</h1>
          <div className="muted">{date} · {team?.n ?? 0} agentes en tu equipo</div>
        </div>
        <form action={runShiftNow}><Submit className="btn" pending="Trabajando turno…">▶ Correr un turno ahora</Submit></form>
      </div>

      <SpacesNav />

      {noBrain && <div className="notice">⚠️ Tus agentes aún no tienen cerebro. Agrega <b>GEMINI_API_KEY</b> en <code>.env.local</code> y reinicia.</div>}

      <div className="grid home-top">
        <section className="card focus">
          <h2>🦒 En qué enfocarte <span className="badge">{list.length}</span></h2>
          {list.length ? (
            <ul className="focus-list">
              {list.slice(0, 5).map((p) => <FocusItem key={p.key} p={p} />)}
            </ul>
          ) : <p className="muted small">Todo al día. 🎉</p>}
          {list.length > 5 && (
            <details>
              <summary className="small muted">Ver {list.length - 5} más</summary>
              <ul className="focus-list">{list.slice(5, 40).map((p) => <FocusItem key={p.key} p={p} />)}</ul>
            </details>
          )}
        </section>

        <section className="card">
          <h2>💬 Habla con Clara</h2>
          <Chat agentId="jefa-gabinete" agentName="Clara" initial={msgs} />
        </section>
      </div>

      <div className="grid g2" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="row spread"><h2>☀️ Brief {brief ? `del ${brief.date}` : ""}</h2>
            <form action={newBrief}><Submit className="btn sm" pending="Preparando…">Actualizar</Submit></form></div>
          {brief ? <details open={brief.date === date}><summary className="small muted">ver brief</summary><Markdown text={brief.content} /></details>
            : <p className="muted">El brief se arma solo cada mañana antes de las 7:00. También puedes pedirlo ahora.</p>}
        </section>

        <section className="card">
          <h2>🌙 Últimas 24 horas</h2>
          {night.length ? (
            <ul className="list">{night.map((r, i) => (
              <li key={i} className="row spread"><span>{r.emoji} {r.name}: <Link href={`/tareas/${r.task_id}`}>{r.title}</Link></span>
                <span className={`badge ${r.status === "ok" ? "b-done" : "b-changes"}`}>{r.status === "ok" ? "entregó" : "error"}</span></li>
            ))}</ul>
          ) : <p className="muted">Aún no hay actividad.</p>}
        </section>

        <section className="card" id="pendientes">
          <h2>✅ Mis pendientes</h2>
          <form action={addTodo} className="row" style={{ marginBottom: 8 }}>
            <input name="text" placeholder="Agregar pendiente…" style={{ flex: 1 }} />
            <input name="due" type="date" style={{ width: 150 }} />
            <button className="btn">+</button>
          </form>
          <ul className="list">{todos.map((t) => (
            <li key={t.id} className="row">
              <form action={toggleTodo}><input type="hidden" name="id" value={t.id} /><button className="btn sm">{t.done ? "↺" : "✓"}</button></form>
              <span style={{ textDecoration: t.done ? "line-through" : "none", flex: 1 }}>{t.text}</span>
              {t.due && <span className="small muted">{t.due}</span>}
            </li>
          ))}</ul>
        </section>
      </div>
    </>
  );
}
