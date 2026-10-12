// Registro de errores: todo lo que falla (chat, agentes, correo, pantallas) queda guardado en la base
// con dónde ocurrió, para revisarlo en Ajustes → Errores y corregirlo.
import { newId, now, run } from "./db";

export const where = () => (process.env.VERCEL ? "web/celular (Vercel)" : process.env.GITHUB_ACTIONS ? "turno en la nube (GitHub)" : "PC");

export async function logError(source: string, err: unknown, detail?: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await run("INSERT INTO error_log(id,source,message,detail,place,created_at) VALUES(?,?,?,?,?,?)",
      [newId(), source, message.slice(0, 2000), detail ? JSON.stringify(detail).slice(0, 4000) : null, where(), now()]);
  } catch { /* si la base tampoco responde, al menos queda en la consola */ }
  console.error(`[${source}]`, message);
}

// Traduce errores técnicos a algo entendible para el CEO.
export function friendly(err: unknown) {
  const m = err instanceof Error ? err.message : String(err);
  if (/503|UNAVAILABLE|high demand|overloaded/i.test(m)) return "El modelo de respaldo está saturado en este momento.";
  if (/429|quota|rate limit|RESOURCE_EXHAUSTED/i.test(m)) return "Se alcanzó el límite de uso del modelo por ahora.";
  if (/timeout|tardó demasiado|aborted/i.test(m)) return "La respuesta tardó demasiado.";
  if (/No hay ningún cerebro/i.test(m)) return "No hay ningún modelo de IA configurado.";
  return "Ocurrió un error inesperado.";
}
