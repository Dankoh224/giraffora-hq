import { login } from "../actions";

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <div style={{ maxWidth: 360, margin: "12vh auto" }} className="card">
      <h1>🦒 Giraffora HQ</h1>
      <p className="muted">Solo para el CEO.</p>
      <form action={login}>
        <div className="field"><input type="password" name="password" placeholder="Contraseña" autoFocus /></div>
        {e && <p style={{ color: "var(--bad)" }} className="small">Contraseña incorrecta</p>}
        <button className="btn primary">Entrar</button>
      </form>
    </div>
  );
}
