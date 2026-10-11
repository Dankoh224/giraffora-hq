"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

// Sube archivos (incluso videos grandes) directo a una carpeta de Archivos, con barra de progreso.
export function Uploader({ dir, label = "Subir archivos" }: { dir: string; label?: string }) {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [drag, setDrag] = useState(false);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const [i, f] of [...files].entries()) {
      await new Promise<void>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/archivos?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(f.name)}`);
        xhr.upload.onprogress = (e) => setStatus(`Subiendo ${f.name} (${i + 1}/${files.length}): ${Math.round((e.loaded / e.total) * 100)}%`);
        xhr.onload = xhr.onerror = () => resolve();
        xhr.send(f);
      });
    }
    setStatus(`✓ ${files.length} archivo(s) subido(s)`);
    router.refresh();
  }

  return (
    <label className="dropzone" data-drag={drag}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
      <input type="file" multiple hidden onChange={(e) => upload(e.target.files)} />
      <b>⬆️ {label}</b>
      <span className="small muted">{status || "Arrastra aquí o haz clic (videos, documentos, imágenes)"}</span>
    </label>
  );
}
