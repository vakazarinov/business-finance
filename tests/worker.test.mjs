import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import worker from "../worker/src/index.js";

globalThis.crypto ??= webcrypto;

function makeDb() {
  const rows = [];
  const shares = [
    { person: "Витя", basis_points: 2500 },
    { person: "Маша", basis_points: 2500 },
    { person: "Петя", basis_points: 2500 },
    { person: "Саша", basis_points: 2500 },
  ];
  const attempts = new Map();
  return {
    rows,
    prepare(sql) {
      let values = [];
      return {
        bind(...args) { values = args; return this; },
        async first() {
          if (sql.includes("FROM login_attempts")) return attempts.get(values[0]) ?? null;
          throw new Error("Unknown first SQL: " + sql);
        },
        async all() {
          if (sql.includes("FROM transactions")) return { results: rows.map((x) => ({ ...x })) };
          if (sql.includes("FROM profit_shares")) return { results: shares.map((x) => ({ ...x })) };
          throw new Error("Unknown all SQL: " + sql);
        },
        async run() {
          if (sql.startsWith("DELETE FROM login_attempts")) { attempts.delete(values[0]); return { meta: { changes: 1 } }; }
          if (sql.startsWith("INSERT INTO login_attempts")) { attempts.set(values[0], { attempts: 1, first_attempt_ms: values[1] }); return { meta: { changes: 1 } }; }
          if (sql.startsWith("UPDATE login_attempts")) { const row = attempts.get(values[0]); if (row) row.attempts++; return { meta: { changes: 1 } }; }
          if (sql.startsWith("INSERT INTO transactions")) {
            const [id, date, type, person, amount_cents, category, comment] = values;
            rows.push({ id, date, type, person, amount_cents, category, comment, created_at: new Date().toISOString() });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE transactions")) {
            const [date, type, person, amount_cents, category, comment, id] = values;
            const row = rows.find((x) => x.id === id);
            if (!row) return { meta: { changes: 0 } };
            Object.assign(row, { date, type, person, amount_cents, category, comment });
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("DELETE FROM transactions")) {
            const index = rows.findIndex((x) => x.id === values[0]);
            if (index === -1) return { meta: { changes: 0 } };
            rows.splice(index, 1);
            return { meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE profit_shares")) {
            const row = shares.find((x) => x.person === values[1]);
            if (row) row.basis_points = values[0];
            return { meta: { changes: row ? 1 : 0 } };
          }
          throw new Error("Unknown run SQL: " + sql);
        },
      };
    },
    async batch(statements) { return Promise.all(statements.map((s) => s.run())); },
  };
}

const url = "https://finance-test.example";
function setup() {
  const env = {
    DB: makeDb(),
    FAMILY_PASSWORD: "test-only-password",
    SESSION_SECRET: "test-secret-not-used-in-production",
    ALLOWED_ORIGIN: "https://site.example",
  };
  async function request(path, method = "GET", body = undefined, token = null, origin = env.ALLOWED_ORIGIN) {
    const headers = { Origin: origin };
    if (token) headers.Authorization = "Bearer " + token;
    if (body) headers["Content-Type"] = "application/json";
    return worker.fetch(new Request(url + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    }), env);
  }
  return { env, request };
}

test("health and CORS preflight respond without credentials", async () => {
  const { request } = setup();
  const health = await request("/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  const cors = await request("/transactions", "OPTIONS");
  assert.equal(cors.status, 204);
  assert.equal(cors.headers.get("access-control-allow-origin"), "https://site.example");
});

test("wrong password is rejected and valid login creates a usable session", async () => {
  const { request } = setup();
  assert.equal((await request("/transactions")).status, 401);
  assert.equal((await request("/login", "POST", { password: "incorrect" })).status, 401);
  const login = await request("/login", "POST", { password: "test-only-password" });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.ok(token);
  assert.equal((await request("/transactions", "GET", undefined, token)).status, 200);
});

test("create, read, edit and delete a transaction; shares remain available", async () => {
  const { request } = setup();
  const auth = await request("/login", "POST", { password: "test-only-password" });
  const { token } = await auth.json();
  const entry = { date: "2026-11-14", type: "income", person: "Витя", amount_cents: 10000, category: "Тест", comment: "" };
  const created = await request("/transactions", "POST", entry, token);
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const items = await request("/transactions", "GET", undefined, token);
  assert.equal((await items.json()).transactions.length, 1);
  const shares = await request("/shares", "GET", undefined, token);
  assert.equal((await shares.json()).shares.length, 4);
  assert.equal((await request("/transactions/" + id, "PATCH", { ...entry, amount_cents: 20000 }, token)).status, 200);
  assert.equal((await request("/transactions/" + id, "DELETE", undefined, token)).status, 200);
  const empty = await request("/transactions", "GET", undefined, token);
  assert.deepEqual((await empty.json()).transactions, []);
});

test("bad entry is rejected before a database write", async () => {
  const { request, env } = setup();
  const auth = await request("/login", "POST", { password: "test-only-password" });
  const { token } = await auth.json();
  const response = await request("/transactions", "POST", {
    date: "2026-11-14", type: "expense", person: "Витя", amount_cents: -50, category: "", comment: ""
  }, token);
  assert.equal(response.status, 400);
  assert.equal(env.DB.rows.length, 0);
});
