import { all, run } from "@/lib/db";
import { revalidatePath } from "next/cache";

async function markResolved(f: FormData) {
  "use server";
  const id = String(f.get("id") ?? "");
  if (id === "todos") await run("UPDATE error_log SET resolved=1 WHERE resolved=0");
  else await run("UPDATE error_log SET resolved=1 WHERE id=?", [id]);
  revalidatePath("/errores");
}

export default async function Errores({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams;
  const rows = await all(`SELECT * FROM error_log ${ver === "todos" ? "" : "WHERE resolved=0"} ORDER BY created_at DESC LIMIT 200`);
  return (
    <>
      <div className="page-head">
        <div><h1>🧯 Registro de errores</h1><div className="muted">Todo lo que falla (chat, agentes, correo, pantallas), con dónde ocurrió. Sirve para corregirlo.</div></div>
        <div className="row">
          <a className="btn sm" href={ver === "todos" ? "/errores" : "/errores?ver=todos"}>{ver === "todos" ? "Solo pendientes" : "Ver resueltos también"}</a>
          {!!rows.length && <form action={markResolved}><input type="hidden" name="id" value="todos" /><button className="btn sm">Marcar todos como revisados</button></form>}
        </div>
      </div>
      {rows.length ? (
        <div className="md"><table>
          <thead><tr><th>Cuándo</th><th>Dónde</th><th>Qué</th><th>Error</th><th></th></tr></thead>
          <tbody>{rows.map((e) => (
            <tr key={e.id} style={{ opacity: e.resolved ? 0.5 : 1 }}>
              <td className="small">{new Date(e.created_at).toLocaleString("es-CL")}</td>
              <td className="small">{e.place}</td>
              <td className="small"><b>{e.source}</b></td>
              <td className="small"><div style={{ whiteSpace: "pre-wrap", maxWidth: 520 }}>{e.message}</div>
                {e.detail && <details><summary className="muted">detalle</summary><pre style={{ whiteSpace: "pre-wrap" }}>{e.detail}</pre></details>}</td>
              <td>{!e.resolved && <form action={markResolved}><input type="hidden" name="id" value={e.id} /><button className="btn sm">✓</button></form>}</td>
            </tr>
          ))}</tbody></table></div>
      ) : <div className="card muted">Sin errores pendientes. 🎉</div>}
    </>
  );
}
