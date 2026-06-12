-- ═══════════════════════════════════════════════════════════
-- HỆ THỐNG QUẢN LÝ DỰ ÁN CNTT TỈNH LÀO CAI — Schema PostgreSQL
-- Nghị định 45/2026/NĐ-CP
-- ═══════════════════════════════════════════════════════════

DROP TABLE IF EXISTS activity_log, urge_log, documents, baselines, steps, projects, workflow_templates, users CASCADE;

CREATE TABLE users (
  id          SERIAL PRIMARY KEY,
  username    VARCHAR(100) UNIQUE NOT NULL,
  password    VARCHAR(255) NOT NULL,
  full_name   VARCHAR(200),
  role        VARCHAR(20) NOT NULL CHECK (role IN ('leader','so','cdt','nt')),
  unit_name   VARCHAR(200),
  unit_type   VARCHAR(20),
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE workflow_templates (
  id          SERIAL PRIMARY KEY,
  type        VARCHAR(20) UNIQUE NOT NULL,
  name        VARCHAR(200) NOT NULL,
  legal_ref   VARCHAR(200),
  steps_json  JSONB NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE projects (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  cdt           VARCHAR(200) NOT NULL,
  cdt_user_id   INTEGER REFERENCES users(id),
  contractor    VARCHAR(200),
  contractor_user_id INTEGER REFERENCES users(id),
  type          VARCHAR(20) NOT NULL,
  fund          VARCHAR(10) NOT NULL,
  grp           VARCHAR(5),
  legal         VARCHAR(200),
  budget        NUMERIC(15,0) DEFAULT 0,
  disb          NUMERIC(5,2) DEFAULT 0,
  disb_plan     NUMERIC(5,2) DEFAULT 0,
  start_date    DATE NOT NULL,
  urged_date    DATE,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_projects_cdt ON projects(cdt_user_id);
CREATE INDEX idx_projects_nt ON projects(contractor_user_id);

CREATE TABLE steps (
  id           SERIAL PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  phase        VARCHAR(5) NOT NULL,
  stt          VARCHAR(20) NOT NULL,
  is_group     BOOLEAN DEFAULT false,
  is_required  BOOLEAN DEFAULT true,
  name         TEXT NOT NULL,
  days         INTEGER DEFAULT 0,
  due_override DATE,
  due_computed DATE,
  actual_date  DATE,
  doc_ref      VARCHAR(300),
  unit         VARCHAR(200),
  owner        VARCHAR(10) DEFAULT 'so',
  note         TEXT,
  skip         BOOLEAN DEFAULT false,
  skip_reason  TEXT,
  pend_data    JSONB,
  product      TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_steps_project ON steps(project_id, seq);

CREATE TABLE baselines (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL,
  date        DATE NOT NULL,
  reason      TEXT NOT NULL,
  slip_days   INTEGER DEFAULT 0,
  auth        VARCHAR(200),
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE documents (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_id     INTEGER REFERENCES steps(id),
  file_name   VARCHAR(300) NOT NULL,
  file_path   VARCHAR(500) NOT NULL,
  file_size   INTEGER,
  uploaded_by INTEGER REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE urge_log (
  id          SERIAL PRIMARY KEY,
  date        DATE NOT NULL,
  subject     VARCHAR(500),
  body        TEXT,
  n_units     INTEGER,
  sent_by     INTEGER REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE activity_log (
  id          SERIAL PRIMARY KEY,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  step_id     INTEGER,
  action      VARCHAR(50) NOT NULL,
  actor_id    INTEGER REFERENCES users(id),
  detail      JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_activity_project ON activity_log(project_id, created_at DESC);
