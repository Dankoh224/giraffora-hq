// Cliente único compatible con la API de OpenAI. Gemini, Groq, OpenRouter y Anthropic
// exponen ese formato, así que cambiar de "cerebro" es cambiar un string.

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string }; [k: string]: unknown };
export type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: object } };

type Provider = { base: string; keyEnv: string; model: string };
export const PROVIDERS: Record<string, Provider> = {
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY", model: "gemini-flash-latest" },
  groq: { base: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", model: "llama-3.3-70b-versatile" },
  openrouter: { base: "https://openrouter.ai/api/v1", keyEnv: "OPENROUTER_API_KEY", model: "meta-llama/llama-3.3-70b-instruct:free" },
  anthropic: { base: "https://api.anthropic.com/v1", keyEnv: "ANTHROPIC_API_KEY", model: "claude-haiku-5-5" },
};

export const availableProviders = () => Object.keys(PROVIDERS).filter((p) => process.env[PROVIDERS[p].keyEnv]);

function parseSpec(spec?: string | null): { provider: string; model: string } | null {
  if (!spec) return null;
  const [provider, ...rest] = spec.split(":");
  if (!PROVIDERS[provider]) return null;
  return { provider, model: rest.join(":") || PROVIDERS[provider].model };
}

// Orden de intento: modelo del agente → DEFAULT_MODEL → resto de proveedores con clave.
function candidates(spec?: string | null) {
  const list: { provider: string; model: string }[] = [];
  for (const s of [parseSpec(spec), parseSpec(process.env.DEFAULT_MODEL)]) {
    if (s && process.env[PROVIDERS[s.provider].keyEnv] && !list.some((x) => x.provider === s.provider)) list.push(s);
  }
  for (const p of availableProviders()) if (!list.some((x) => x.provider === p)) list.push({ provider: p, model: PROVIDERS[p].model });
  return list;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function chat(messages: Msg[], tools?: ToolDef[], spec?: string | null) {
  const list = candidates(spec);
  if (!list.length) throw new Error("No hay ningún cerebro IA configurado. Agrega GEMINI_API_KEY (gratis) en .env.local");
  let lastErr = "";
  for (const c of list) {
    const p = PROVIDERS[c.provider];
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`${p.base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env[p.keyEnv]}` },
        signal: AbortSignal.timeout(120000),
        body: JSON.stringify({ model: c.model, messages, ...(tools?.length ? { tools, tool_choice: "auto" } : {}), temperature: 0.6 }),
      });
      if (res.ok) {
        const data = await res.json();
        const m = data.choices?.[0]?.message ?? {};
        // Solo devolvemos campos estándar (algunos proveedores rechazan campos extra al reenviarlos).
        const message: Msg = { role: "assistant", content: m.content ?? null, ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}) };
        return { message, model: `${c.provider}:${c.model}`, usage: data.usage ?? null };
      }
      lastErr = `${c.provider} ${res.status}: ${(await res.text()).slice(0, 300)}`;
      if (res.status === 429 && attempt === 0) { await sleep(15000); continue; }
      break; // otro error → siguiente proveedor
    }
  }
  throw new Error(lastErr);
}
