// Errores de pantalla (navegador del PC o celular) → registro de errores.
import { logError } from "@/lib/errors";

export async function POST(req: Request) {
  const { message, digest, path } = await req.json().catch(() => ({}));
  await logError("pantalla", String(message ?? "error de pantalla"), { digest, path });
  return Response.json({ ok: true });
}
