# 🦒 Giraffora HQ — la empresa virtual

Tú eres el CEO. Un equipo de agentes de IA trabaja por áreas todo el día, también de noche con tu PC
apagado: a las 7:00 ya tienes avances, investigaciones y borradores listos para revisar, y durante el día
siguen iterando contigo hasta que apruebas.

## Cómo funciona

```
 Tú (PC / celular)  ──►  App Giraffora HQ  ◄──►  Datawarehouse (SQLite / Turso)  ◄──  n8n (Gmail, WhatsApp, Calendar, Notion)
                                                        ▲
                     GitHub Actions (cada hora, 24 h)   ┘──► Agentes ──► Gemini / Groq (gratis) · Claude (opcional)
```

- **Equipo**: áreas → agentes con cargo, rango (director/senior/junior), habilidades e instrucciones.
  Contratas desde un catálogo (`lib/templates.ts`) o creas puestos a medida. Clara (Jefa de Gabinete)
  también contrata sola cuando le encargas algo que nadie del equipo sabe hacer.
- **Ciclo de trabajo**: tarea → el agente entrega v1 → tú comentas → v2 → … → apruebas.
  "Corregir ya" lo rehace en el momento; "Corregir de noche" lo deja para el turno.
- **Horario**: un turno cada hora, todo el día. De 00:00 a 06:00 toman más tareas por turno, y el brief
  se arma a las 6:00 para que a las 7:00 esté todo listo.
- **Archivos**: cada entrega queda como archivo en `Archivos/<Área>/<Agente>/<fecha tarea>/`
  (`entrega.md`, `versiones/`, `imagenes/`). Puedes abrirlos, editarlos, copiarlos o borrarlos desde la app
  o desde el Explorador. Si editas `entrega.md` a mano, tu versión queda como nueva versión y el agente
  trabaja sobre ella. Lo que borras va a `Archivos/_Papelera`.
- **Agentes en tu PC (Claude Code)**: el Editor de Video y la Ingeniera de Software trabajan con tus
  archivos locales. Subes el video a la carpeta de la tarea, el worker abre Claude Code ahí, y el resultado
  (sin silencios, subtítulos, color, sonidos) queda en `resultado/`. Estos solo trabajan con el PC encendido.
- **Rutinas**: cada agente puede tener una tarea diaria a cierta hora (licitaciones a las 2:00,
  investigación a la 1:00, eventos a las 3:00…).
- **Brief matinal**: listo antes de las 7:00, Ema resume quién te escribió, tu agenda, pendientes y lo que hizo el equipo.
- **Bandeja**: los agentes nunca envían nada solos. WhatsApp, correos, LinkedIn y llamadas quedan como
  borradores; al aprobarlos, n8n los envía.

## 1. Probar en tu PC (hoy, costo cero)

1. Crea una clave gratis de Gemini en https://aistudio.google.com/apikey y pégala en `.env.local` (`GEMINI_API_KEY=`).
2. En esta carpeta:
   ```bash
   npm run build
   ```
   ```bash
   npm run start
   ```
3. Abre http://localhost:3000 → escribe una misión en Inicio → marca "empezar ya".

Desde Claude Code también puedes encargar trabajo: `npm run tarea -- "Título" "Brief" [agent_id]`,
o correr un turno completo con `npm run turno`.

### Encender todo en tu PC

Doble clic en `iniciar-giraffora.bat`: abre la app y el **worker** (copia entregas a Archivos y ejecuta
los trabajos de Claude Code). Para que arranque solo: Win+R → `shell:startup` → pega ahí un acceso directo.

Para los agentes de video necesitas, una sola vez:
```bash
winget install Gyan.FFmpeg
```
```bash
claude
```
(el segundo abre Claude Code: inicia sesión con `/login` y ciérralo). Para subtítulos gratis agrega
`GROQ_API_KEY` (console.groq.com) en `.env.local`. Música y sonidos reutilizables van en `Archivos/Recursos`.

## 2. Que trabajen con el PC apagado (gratis)

1. **Turso** (SQLite en la nube): crea cuenta en https://turso.tech, una base `giraffora`, y copia la URL
   `libsql://...` y el token. Ponlos en `.env.local` como `DATABASE_URL` y `DATABASE_AUTH_TOKEN`.
2. **GitHub**: sube esta carpeta a un repositorio **privado**. En Settings → Secrets and variables → Actions,
   agrega los secrets `DATABASE_URL`, `DATABASE_AUTH_TOKEN`, `GEMINI_API_KEY` (y los opcionales).
   El workflow `.github/workflows/turnos.yml` corre cada hora, todo el día.
3. **Vercel** (app en el celular): importa el repo en https://vercel.com, agrega las mismas variables
   + `APP_PASSWORD`. Abre la URL en el celular → "Agregar a pantalla de inicio".
   En el celular ves y apruebas todo el trabajo; los archivos pesados (videos) viven en tu PC. Si quieres
   verlos también en el celular, pon `FILES_DIR` dentro de tu carpeta de Google Drive para escritorio.

## 3. Correo: secretaria + newsletter (sin n8n ni plataformas de mailing)

**Secretaria (Teresa):** cada 30 min lee tus cuentas, las clasifica (cliente, estudiante, amigo, compra, spam…) con
importancia de 1 a 5, archiva solo las promociones, Clara te lo pone primero en tus prioridades de la app. En
**Correo** le dices qué hacer con cada uno: "respóndele esto", "conviértelo en tarea", "no tomar en cuenta". Redacta,
tú revisas y presionas Enviar: sale desde la misma cuenta, como respuesta en el mismo hilo.

Conectar cada cuenta de Gmail (también la de dominio propio):
1. Activa la verificación en 2 pasos en esa cuenta de Google.
2. Crea una contraseña de aplicación en https://myaccount.google.com/apppasswords
3. En `.env.local` completa `MAIL_1_USER` / `MAIL_1_PASS` (y 2 y 3). Nunca uses tu contraseña normal.

**Contactos:** importa tus Sheets (descargados como CSV) y Excels. Se unifican por correo, sin duplicados, con
nicho detectado por cargo o institución, origen de cada contacto y estado de suscripción. Quien se da de baja
(link o respondiendo "BAJA") no vuelve a recibir envíos aunque lo reimportes.

**Newsletter:** en Newsletter activas el semanal (día y hora). La noche anterior Elisa investiga y escribe un
artículo por nicho; te quedan como borradores para aprobar. Los envíos puntuales se los pides a Clara o a Elisa
("haz un correo para ofrecer el curso X a todos los suscriptores"). Salen desde tu correo de empresa, uno a uno,
con link de baja; si Gmail pide pausa se retoma solo en el próximo turno.

## 4. Conectar más fuentes (n8n)

n8n lee tus cuentas y escribe en el datawarehouse vía `POST /api/ingest` (header `x-ingest-secret`):

```json
{ "source": "gmail", "kind": "correo", "from_name": "Ana Pérez", "from_contact": "ana@colegio.cl",
  "category": "cliente", "title": "Cotización curso IA", "body": "...", "occurred_at": "2026-10-11T09:00:00Z" }
```

Flujos sugeridos: Gmail (nuevos correos) · Google Calendar (eventos del día) · WhatsApp Business Cloud API
(mensajes entrantes) · Notion (pendientes) · confirmaciones de compra. Y un flujo que reciba la Bandeja
aprobada en `N8N_OUTBOX_WEBHOOK` y envíe por el canal correcto (llamadas: Vapi/Retell/Twilio).

n8n puede correr gratis en tu PC (`npx n8n`) o 24/7 en Oracle Cloud Always Free.

> LinkedIn prohíbe la automatización de mensajes: por eso los agentes dejan los mensajes listos y tú los envías.

## Agregar un puesto al catálogo

Agrega un objeto a `TEMPLATES` en `lib/templates.ts` (área, cargo, rango, habilidades, instrucciones, rutina).
Para una habilidad nueva, agrega una herramienta en `lib/tools.ts`.
