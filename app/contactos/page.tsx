import { all } from "@/lib/db";
import { niches } from "@/lib/contacts";
import { Submit } from "@/components/Submit";
import { importContactsAction, saveNiches, updateContact } from "../actions-mail";

export default async function Contactos({ searchParams }: { searchParams: Promise<{ msg?: string; n?: string; q?: string; e?: string }> }) {
  const { msg, n = "", q = "", e = "" } = await searchParams;
  const list = await niches();
  const where: string[] = [];
  const args: string[] = [];
  if (n === "sin") where.push("(niches IS NULL OR niches='')");
  else if (n) { where.push("(',' || coalesce(niches,'') || ',') LIKE ?"); args.push(`%,${n},%`); }
  if (e === "baja") where.push("subscribed=0"); else if (e === "rebote") where.push("bounced=1"); else if (e === "activo") where.push("subscribed=1 AND bounced=0");
  if (q) { where.push("(lower(name) LIKE ? OR lower(email) LIKE ? OR lower(coalesce(company,'')) LIKE ?)"); args.push(...Array(3).fill(`%${q.toLowerCase()}%`)); }
  const rows = await all(`SELECT * FROM contacts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY updated_at DESC LIMIT 300`, args);
  const st = (await all(`SELECT COUNT(*) AS total, SUM(subscribed=1 AND bounced=0) AS activos, SUM(subscribed=0) AS bajas, SUM(bounced=1) AS rebotes,
    SUM(niches IS NULL OR niches='') AS sin_nicho FROM contacts`))[0];
  const byNiche = await Promise.all(list.map(async (x) => ({ ...x, n: (await all("SELECT COUNT(*) AS n FROM contacts WHERE subscribed=1 AND bounced=0 AND (',' || coalesce(niches,'') || ',') LIKE ?", [`%,${x.id},%`]))[0].n })));
  const link = (p: Record<string, string>) => `/contactos?${new URLSearchParams({ n, q, e, ...p }).toString()}`;

  return (
    <>
      <div className="page-head">
        <div><h1>Contactos</h1><div className="muted">Una sola base, limpia y sin duplicados. El correo es la llave; quien se da de baja nunca vuelve a recibir envíos.</div></div>
      </div>
      {msg && <div className="notice">{msg}</div>}

      <div className="stats">
        <a className="stat" href={link({ e: "activo", n: "" })}><b>{st.activos ?? 0}</b><span>suscritos activos</span></a>
        {byNiche.map((x) => <a key={x.id} className="stat" href={link({ n: x.id })}><b>{x.n}</b><span>{x.name}</span></a>)}
        <a className="stat" href={link({ n: "sin" })}><b>{st.sin_nicho ?? 0}</b><span>sin nicho</span></a>
        <a className="stat" href={link({ e: "baja", n: "" })}><b>{st.bajas ?? 0}</b><span>dados de baja</span></a>
      </div>

      <div className="grid g2" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>⬆️ Importar desde Google Sheets o Excel</h2>
          <p className="small muted">En Sheets: Archivo → Descargar → CSV. En Excel sube el .xlsx directo. Detecto solas las columnas de correo, nombre, empresa, teléfono, cargo y nicho.</p>
          <form action={importContactsAction}>
            <div className="field"><input type="file" name="file" accept=".csv,.xlsx" required /></div>
            <div className="row">
              <input name="source" placeholder="Origen (ej: Inscritos taller mayo)" style={{ flex: 2 }} />
              <select name="niche" style={{ flex: 1 }} defaultValue="">
                <option value="">Nicho: detectar solo</option>
                {list.map((x) => <option key={x.id} value={x.id}>Todos → {x.name}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 8 }}><Submit pending="Importando…">Importar</Submit></div>
          </form>
        </section>
        <section className="card">
          <h2>🏷️ Nichos</h2>
          <form action={saveNiches}>
            <p className="small muted">Uno por línea: <code>id | Nombre | descripción | palabras clave para detectarlo</code></p>
            <textarea name="niches" style={{ minHeight: 120, fontFamily: "ui-monospace, Consolas, monospace", fontSize: ".8rem" }}
              defaultValue={list.map((x) => `${x.id} | ${x.name} | ${x.desc} | ${x.keywords}`).join("\n")} />
            <button className="btn" style={{ marginTop: 6 }}>Guardar nichos</button>
          </form>
        </section>
      </div>

      <section className="card">
        <form className="row" style={{ marginBottom: 10 }}>
          <input name="q" defaultValue={q} placeholder="Buscar nombre, correo u organización" style={{ flex: 1 }} />
          <input type="hidden" name="n" value={n} /><input type="hidden" name="e" value={e} />
          <button className="btn">Buscar</button>
          {(n || q || e) && <a className="btn" href="/contactos">Limpiar filtros</a>}
        </form>
        <div className="md"><table>
          <thead><tr><th>Contacto</th><th>Nichos</th><th>Origen</th><th>Estado</th></tr></thead>
          <tbody>{rows.map((c) => {
            const mine = (c.niches ?? "").split(",");
            return (
              <tr key={c.id}>
                <td><b>{c.name}</b><div className="small muted">{c.email}{c.company && ` · ${c.company}`}</div></td>
                <td>
                  <form action={updateContact} className="row" style={{ gap: 4 }}>
                    <input type="hidden" name="id" value={c.id} />
                    {list.map((x) => (
                      <label key={x.id} className="small" style={{ display: "inline-flex", gap: 3, margin: 0, color: "var(--text)", fontWeight: 400 }}>
                        <input type="checkbox" name="niches" value={x.id} defaultChecked={mine.includes(x.id)} style={{ width: "auto" }} />{x.name}
                      </label>
                    ))}
                    <button className="btn sm">✓</button>
                  </form>
                </td>
                <td className="small muted">{c.source}</td>
                <td>
                  <form action={updateContact} className="row" style={{ gap: 4 }}>
                    <input type="hidden" name="id" value={c.id} />
                    {c.bounced ? <span className="badge b-changes">rebotó</span> : c.subscribed ? <span className="badge b-done">suscrito</span> : <span className="badge">de baja</span>}
                    <button className="btn sm" name="subscribed" value={c.subscribed ? "0" : "1"}>{c.subscribed ? "Dar de baja" : "Reactivar"}</button>
                  </form>
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {!rows.length && <p className="muted">Sin contactos todavía. Importa tu primer archivo.</p>}
        <p className="small muted">Total en la base: {st.total ?? 0} · mostrando hasta 300.</p>
      </section>
    </>
  );
}
