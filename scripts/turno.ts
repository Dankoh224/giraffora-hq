// Turno de trabajo. Lo ejecuta GitHub Actions cada hora en la noche (con tu PC apagado)
// o tú a mano: npm run turno
import { shift } from "../lib/engine";

shift({ log: console.log })
  .then(() => process.exitCode = 0)
  .catch((e) => { console.error(e); process.exitCode = 1; });
