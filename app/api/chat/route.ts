import { chatWithAgent } from "@/lib/engine";

export const maxDuration = 60;

export async function POST(req: Request) {
  const { agentId, text } = await req.json();
  try {
    return Response.json(await chatWithAgent(agentId, String(text ?? "")));
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
