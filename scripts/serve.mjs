// Arranca la app desde la carpeta del proyecto, sin importar desde dónde se llame.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
process.argv = [process.argv[0], "next", "start", "-p", process.env.PORT || "3000"];
await import("../node_modules/next/dist/bin/next");
