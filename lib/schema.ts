// Datawarehouse único de Giraffora. Todo vive aquí: equipo, tareas, entregables,
// conversaciones, CRM, eventos que llegan desde n8n (correo, WhatsApp, calendario, Notion).
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, emoji TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, area_id TEXT NOT NULL, template_id TEXT,
  name TEXT NOT NULL, role TEXT NOT NULL, rank TEXT NOT NULL DEFAULT 'senior',
  emoji TEXT, skills TEXT NOT NULL DEFAULT '[]', system_prompt TEXT NOT NULL,
  model TEXT, routine TEXT, routine_hour INTEGER, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT, agent_id TEXT, parent_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued', priority INTEGER NOT NULL DEFAULT 2,
  iteration INTEGER NOT NULL DEFAULT 0, created_by TEXT DEFAULT 'ceo',
  created_at TEXT, updated_at TEXT
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);

CREATE TABLE IF NOT EXISTS deliverables (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_id TEXT, version INTEGER NOT NULL,
  content TEXT NOT NULL, created_at TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, decision TEXT, body TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, agent_id TEXT, task_id TEXT, kind TEXT, status TEXT,
  log TEXT, error TEXT, started_at TEXT, finished_at TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT,
  meta TEXT, created_at TEXT
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY, agent_id TEXT, task_id TEXT, channel TEXT NOT NULL,
  recipient TEXT, subject TEXT, body TEXT, status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT, decided_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, source TEXT NOT NULL, kind TEXT, from_name TEXT, from_contact TEXT,
  category TEXT DEFAULT 'sin_clasificar', title TEXT, body TEXT, occurred_at TEXT,
  raw TEXT, created_at TEXT
);
CREATE INDEX IF NOT EXISTS events_time ON events(occurred_at);

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT, company TEXT, email TEXT,
  phone TEXT, linkedin TEXT, stage TEXT, notes TEXT, created_at TEXT, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY, text TEXT NOT NULL, due TEXT, done INTEGER NOT NULL DEFAULT 0,
  created_at TEXT, done_at TEXT
);

-- Correos de tus cuentas, clasificados por la secretaria
CREATE TABLE IF NOT EXISTS emails (
  id TEXT PRIMARY KEY, account TEXT NOT NULL, message_id TEXT NOT NULL, refs TEXT,
  from_name TEXT, from_email TEXT, to_addr TEXT, subject TEXT, body TEXT, received_at TEXT,
  importance INTEGER, category TEXT, summary TEXT, suggested_action TEXT,
  status TEXT NOT NULL DEFAULT 'nuevo', instruction TEXT, created_at TEXT,
  UNIQUE(account, message_id)
);
CREATE INDEX IF NOT EXISTS emails_status ON emails(status, importance);

-- Newsletter y envíos masivos
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, niche TEXT NOT NULL DEFAULT 'todos', subject TEXT NOT NULL,
  body TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'borrador', kind TEXT DEFAULT 'puntual',
  agent_id TEXT, task_id TEXT, sent_count INTEGER NOT NULL DEFAULT 0, send_at TEXT, created_at TEXT, approved_at TEXT, sent_at TEXT
);
CREATE TABLE IF NOT EXISTS campaign_sends (
  campaign_id TEXT NOT NULL, contact_id TEXT NOT NULL, status TEXT NOT NULL, error TEXT, sent_at TEXT,
  PRIMARY KEY (campaign_id, contact_id)
);

-- Avisos para el CEO (los levantan los agentes; Clara los ordena en tus prioridades)
CREATE TABLE IF NOT EXISTS notices (
  id TEXT PRIMARY KEY, agent_id TEXT, priority INTEGER NOT NULL DEFAULT 2, title TEXT NOT NULL, body TEXT,
  link TEXT, status TEXT NOT NULL DEFAULT 'open', created_at TEXT, done_at TEXT
);

-- Plantillas HTML de los newsletters de Giraffora
CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, html TEXT NOT NULL, updated_at TEXT
);

CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY, date TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT
);
`;

export const MIGRATIONS = [
  // 'cloud' = trabaja en la nube con el LLM; 'claude-code' = trabaja en tu PC con Claude Code y tus archivos
  "ALTER TABLE agents ADD COLUMN runner TEXT NOT NULL DEFAULT 'cloud'",
  // Carpeta de la tarea dentro de Archivos/ y fecha de la última escritura de entrega.md
  "ALTER TABLE tasks ADD COLUMN folder TEXT",
  "ALTER TABLE tasks ADD COLUMN file_mtime REAL",
  // Quién escribió la versión (agente o 'ceo' si la editaste tú) y cuándo se copió a la carpeta
  "ALTER TABLE deliverables ADD COLUMN author TEXT",
  "ALTER TABLE deliverables ADD COLUMN exported_at TEXT",
  // Respuestas de correo: desde qué cuenta y a qué correo responden
  "ALTER TABLE outbox ADD COLUMN account TEXT",
  "ALTER TABLE outbox ADD COLUMN email_id TEXT",
  "ALTER TABLE outbox ADD COLUMN error TEXT",
  // Gobernanza de contactos: nichos, suscripción, origen, rebotes
  "ALTER TABLE contacts ADD COLUMN niches TEXT",
  "ALTER TABLE contacts ADD COLUMN subscribed INTEGER NOT NULL DEFAULT 1",
  "ALTER TABLE contacts ADD COLUMN source TEXT",
  "ALTER TABLE contacts ADD COLUMN token TEXT",
  "ALTER TABLE contacts ADD COLUMN bounced INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE contacts ADD COLUMN unsubscribed_at TEXT",
  "ALTER TABLE contacts ADD COLUMN last_email_at TEXT",
  "ALTER TABLE campaigns ADD COLUMN template TEXT",
  "CREATE UNIQUE INDEX IF NOT EXISTS contacts_email ON contacts(lower(email)) WHERE email IS NOT NULL AND email != ''",
];
