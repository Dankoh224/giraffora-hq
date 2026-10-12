"use client";
import { useEffect, useRef } from "react";
import { archiveTask, deleteTask, restoreTask } from "@/app/actions";

// Menú ⋯ de una tarea: archivar, restaurar o eliminar (con confirmación).
export function TaskMenu({ id, archived, back }: { id: string; archived?: boolean; back?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => ref.current?.removeAttribute("open");
  // Se cierra al hacer clic fuera del menú.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);
  return (
    <details className="menu" ref={ref} onClick={(e) => e.stopPropagation()}>
      <summary title="Opciones" onClick={(e) => e.stopPropagation()}>⋯</summary>
      <div className="menu-pop">
        {archived ? (
          <form action={restoreTask} onSubmit={close}><input type="hidden" name="task_id" value={id} /><button>↩️ Restaurar</button></form>
        ) : (
          <form action={archiveTask} onSubmit={close}><input type="hidden" name="task_id" value={id} /><button>🗄️ Archivar</button></form>
        )}
        <form action={deleteTask} onSubmit={(e) => { if (!confirm("¿Eliminar esta tarea y sus subtareas para siempre? No se puede deshacer.")) e.preventDefault(); else close(); }}>
          <input type="hidden" name="task_id" value={id} />
          {back && <input type="hidden" name="back" value={back} />}
          <button className="danger">🗑️ Eliminar</button>
        </form>
      </div>
    </details>
  );
}
