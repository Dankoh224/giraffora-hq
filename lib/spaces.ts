// Espacios de trabajo: agrupan áreas, sus módulos y sus agentes. Aparecen en la barra del inicio.
// Agregar un espacio o un módulo nuevo = agregar un objeto aquí.
export type Space = {
  id: string; name: string; emoji: string; description: string; areas: string[];
  modules: { href: string; icon: string; label: string; hint: string }[];
};

export const SPACES: Space[] = [
  {
    id: "comercial", name: "Comercial", emoji: "🧭", description: "Licitaciones, fondos, alianzas corporativas, eventos y charlas.",
    areas: ["oportunidades", "alianzas", "rrpp"],
    modules: [
      { href: "/licitaciones", icon: "🔎", label: "Licitaciones", hint: "Las que podemos cumplir y sus ofertas" },
      { href: "/tareas", icon: "🤝", label: "Alianzas", hint: "Reuniones con corporaciones" },
    ],
  },
  {
    id: "marketing", name: "Marketing", emoji: "📣", description: "Campañas, newsletter, redes, reels, afiches, podcast y video.",
    areas: ["marketing", "estudio"],
    modules: [
      { href: "/newsletter", icon: "📰", label: "Newsletter", hint: "Semanal por nicho y envíos" },
      { href: "/contactos", icon: "👥", label: "Suscriptores", hint: "Base y Excel por nicho" },
      { href: "/archivos?p=Marketing", icon: "🎨", label: "Piezas", hint: "Afiches, guiones y videos" },
    ],
  },
  {
    id: "ventas", name: "Ventas", emoji: "💼", description: "CRM, prospección, seguimiento, postventa y fidelización.",
    areas: ["ventas"],
    modules: [
      { href: "/crm", icon: "🗂️", label: "CRM", hint: "Pipeline y próximas acciones" },
      { href: "/crm?vista=postventa", icon: "💛", label: "Postventa y fidelización", hint: "Clientes que ya compraron" },
      { href: "/correo", icon: "📧", label: "Correo", hint: "Respuestas a clientes" },
      { href: "/bandeja", icon: "📤", label: "Mensajes por aprobar", hint: "WhatsApp, LinkedIn, llamadas" },
    ],
  },
  {
    id: "producto", name: "Producto", emoji: "🎓", description: "Programas, cursos de IA y materiales.",
    areas: ["pedagogia"],
    modules: [{ href: "/archivos?p=Pedagog%C3%ADa", icon: "📚", label: "Programas y materiales", hint: "Lo que entrega Pedagogía" }],
  },
  {
    id: "id", name: "I+D", emoji: "🧪", description: "Laboratorios de investigación, automatizaciones y prototipos.",
    areas: ["laboratorios"],
    modules: [{ href: "/archivos?p=Laboratorios%20de%20IA", icon: "🧪", label: "Resultados de los labs", hint: "Informes, código y prototipos" }],
  },
  {
    id: "operaciones", name: "Operaciones", emoji: "🗂️", description: "Oficina del CEO, datos, reportes y archivos.",
    areas: ["direccion", "oficina-ceo", "operaciones"],
    modules: [
      { href: "/datos", icon: "🗄️", label: "Datos", hint: "Eventos y datawarehouse" },
      { href: "/archivos", icon: "📁", label: "Archivos", hint: "Todo lo que producen" },
    ],
  },
];

export const spaceById = (id: string) => SPACES.find((s) => s.id === id);
export const spaceOfArea = (areaId: string) => SPACES.find((s) => s.areas.includes(areaId));
