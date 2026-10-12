import { chatWithAgent } from "@/lib/engine";
import { friendly, logError } from "@/lib/errors";

export const maxDuration = 60;

// Conversación en vivo. Si algo falla, queda en el registro de errores y se avisa con un mensaje claro.
export async function POST(req: Request) {
  let agentId = "", text = "";
  try {
    ({ agentId, text } = await req.json());
    const budget = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout: la respuesta tardó demasiado")), 55_000));
    return Response.json(await Promise.race([chatWithAgent(agentId, String(text ?? "")), budget]));
  } catch (e: any) {
    await logError("chat", e, { agentId, text: String(text).slice(0, 500) });
    return Response.json({ reply: `⚠️ ${friendly(e)} Inténtalo de nuevo en un momento. (Quedó en Errores para revisarlo).`, tools: [], error: true });
  }
}
