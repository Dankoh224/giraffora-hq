"use client";
import { marked } from "marked";
import { sanitize } from "./Markdown";
import { useEffect, useRef, useState } from "react";

type M = { role: "user" | "assistant"; content: string; tools?: string[] };

export function Chat({ agentId, agentName, initial }: { agentId: string; agentName: string; initial: M[] }) {
  const [msgs, setMsgs] = useState<M[]>(initial);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs, busy]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setMsgs((m) => [...m, { role: "user", content: t }]);
    setText("");
    setBusy(true);
    try {
      const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId, text: t }) });
      const d = await r.json();
      setMsgs((m) => [...m, { role: "assistant", content: d.reply ?? `⚠️ ${d.error}`, tools: d.tools }]);
    } catch (err: any) {
      setMsgs((m) => [...m, { role: "assistant", content: `⚠️ ${err.message}` }]);
    }
    setBusy(false);
  }

  return (
    <div className="chat">
      <div className="chat-log">
        {!msgs.length && <p className="muted">Habla con {agentName}: pídele ideas, revisa avances o encárgale trabajo.</p>}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="bubble user">{m.content}</div>
          ) : (
            <div key={i} className="bubble assistant">
              {!!m.tools?.length && <div className="small muted">🛠 {m.tools.join(" · ")}</div>}
              <div className="md" dangerouslySetInnerHTML={{ __html: sanitize(marked.parse(m.content ?? "", { async: false, breaks: true }) as string) }} />
            </div>
          ),
        )}
        {busy && <div className="bubble assistant muted">{agentName} está pensando…</div>}
        <div ref={end} />
      </div>
      <form className="chat-form" onSubmit={send}>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`Escríbele a ${agentName}…`}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) send(e); }} />
        <button className="btn primary" disabled={busy}>Enviar</button>
      </form>
    </div>
  );
}
