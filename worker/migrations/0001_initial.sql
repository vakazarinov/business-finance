-- Amounts are stored as integer kopeks to avoid floating point rounding.
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  person TEXT NOT NULL CHECK (person IN ('Витя', 'Маша', 'Петя', 'Саша')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  category TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS profit_shares (
  person TEXT PRIMARY KEY CHECK (person IN ('Витя', 'Маша', 'Петя', 'Саша')),
  basis_points INTEGER NOT NULL CHECK (basis_points BETWEEN 0 AND 10000)
);
INSERT OR IGNORE INTO profit_shares(person, basis_points) VALUES
 ('Витя', 2500), ('Маша', 2500), ('Петя', 2500), ('Саша', 2500);

-- Password attempts are keyed by a one-way, secret-salted IP digest.
CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt_ms INTEGER NOT NULL
);
