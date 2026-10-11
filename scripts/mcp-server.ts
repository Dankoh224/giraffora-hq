// Servidor MCP de Giraffora: expone a Claude Code las habilidades de UN agente
// (delegar, contratar, CRM, newsletter, borradores…). Lo lanza lib/claude.ts por cada trabajo.
// Variables: GIRAFFORA_AGENT_ID, GIRAFFORA_TASK_ID (opcional), GIRAFFORA_QUESTIONS_FILE.
// Importante: nada de console.log aquí — stdout es el canal del protocolo MCP.
import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getAgent } from "../lib/org";
import { executeTool, TOOLS, type ToolCtx } from "../lib/tools";

// Claude ya trae búsqueda y lectura web propias (mejores); no las duplicamos.
const NATIVE = new Set(["web_search", "read_url"]);

(async () => {
  const agent = await getAgent(process.env.GIRAFFORA_AGENT_ID ?? "");
  if (!agent) throw new Error("Agente no encontrado");
  const skills = [...new Set([...(JSON.parse(agent.skills || "[]") as string[]), "ask_ceo"])].filter((s) => TOOLS[s] && !NATIVE.has(s));
  const ctx: ToolCtx = { agent, taskId: process.env.GIRAFFORA_TASK_ID || undefined, questions: [] };

  const server = new Server({ name: "giraffora", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: skills.map((s) => ({ name: s, description: TOOLS[s].def.description, inputSchema: TOOLS[s].def.parameters as any })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
      const out = await executeTool(name, args, ctx);
      if (name === "ask_ceo" && process.env.GIRAFFORA_QUESTIONS_FILE) appendFileSync(process.env.GIRAFFORA_QUESTIONS_FILE, `${(args as any).question}\n`);
      return { content: [{ type: "text", text: out }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `ERROR: ${e.message}` }], isError: true };
    }
  });
  await server.connect(new StdioServerTransport());
})();
