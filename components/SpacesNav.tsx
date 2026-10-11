import Link from "next/link";
import { SPACES } from "@/lib/spaces";

export function SpacesNav({ active }: { active?: string }) {
  return (
    <nav className="spaces">
      {SPACES.map((s) => (
        <Link key={s.id} href={`/espacio/${s.id}`} className={active === s.id ? "on" : ""}>
          <span>{s.emoji}</span>{s.name}
        </Link>
      ))}
    </nav>
  );
}
