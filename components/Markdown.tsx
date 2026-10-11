import { marked } from "marked";

// El contenido viene de modelos que leen la web: quitamos scripts y atributos on*.
export function sanitize(html: string) {
  return html
    .replace(/<(script|iframe|object|embed|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, "$1=\"#\"");
}

export function Markdown({ text }: { text: string }) {
  const html = sanitize(marked.parse(text ?? "", { async: false, gfm: true, breaks: true }) as string);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}
