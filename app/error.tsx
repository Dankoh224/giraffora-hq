"use client";
import { useEffect } from "react";

// Si algo falla en una pantalla, se muestra esto en vez de una página rota.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    fetch("/api/errores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: error.message, digest: error.digest, path: location.pathname }) }).catch(() => {});
  }, [error]);
  return (
    <div className="card" style={{ maxWidth: 520, margin: "10vh auto" }}>
      <h2>🦒 Algo se trabó</h2>
      <p className="muted">No se perdió nada: lo que hicieron los agentes quedó guardado. Prueba de nuevo.</p>
      <p className="small muted">{error.message}</p>
      <div className="row">
        <button className="btn primary" onClick={() => reset()}>Reintentar</button>
        <a className="btn" href="/">Ir al inicio</a>
      </div>
    </div>
  );
}
