const PEOPLE = ["Витя", "Маша", "Петя", "Саша"];
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const ALLOWED_METHODS = "GET,POST,PATCH,PUT,DELETE,OPTIONS";
const textEncoder = new TextEncoder();

function b64url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function fromB64url(value) {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}
async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder.encode(value)));
}
async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value)));
}
function equals(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function makeToken(secret) {
  const body = b64url(textEncoder.encode(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS, nonce: crypto.randomUUID() })));
  return body + "." + b64url(await hmac(body, secret));
}
async function tokenValid(token, secret) {
  if (!token || token.length > 2048) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const expected = await hmac(parts[0], secret);
    if (!equals(fromB64url(parts[1]), expected)) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(parts[0])));
    return Number.isSafeInteger(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
function headers(env, origin) {
  const h = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  };
  if (origin && origin === env.ALLOWED_ORIGIN) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
    h["Access-Control-Allow-Methods"] = ALLOWED_METHODS;
    h["Access-Control-Max-Age"] = "600";
  }
  return h;
}
function response(data, status, env, origin) {
  return new Response(JSON.stringify(data), { status, headers: headers(env, origin) });
}
function validDate(date) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date + "T00:00:00Z");
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}
function validateEntry(body) {
  if (!body || typeof body !== "object" || !validDate(body.date)) return "Некорректная дата";
  if (!["income", "expense"].includes(body.type)) return "Некорректный тип операции";
  if (!PEOPLE.includes(body.person)) return "Некорректный участник";
  if (!Number.isSafeInteger(body.amount_cents) || body.amount_cents <= 0 || body.amount_cents > 100000000000) return "Некорректная сумма";
  if (typeof body.category !== "string" || body.category.length > 80) return "Некорректная категория";
  if (typeof body.comment !== "string" || body.comment.length > 500) return "Слишком длинный комментарий";
  return null;
}
async function readJson(request) {
  if (Number(request.headers.get("Content-Length") || 0) > 8192) throw Error("Размер запроса превышен");
  const text = await request.text();
  if (text.length > 8192) throw Error("Размер запроса превышен");
  return JSON.parse(text);
}
async function login(request, env, origin) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = b64url(await hmac("ip:" + ip, env.SESSION_SECRET));
  const now = Date.now();
  const row = await env.DB.prepare("SELECT attempts, first_attempt_ms FROM login_attempts WHERE key=?").bind(key).first();
  if (row && now - row.first_attempt_ms < 15 * 60 * 1000 && row.attempts >= 8) return response({ error: "Слишком много попыток. Повторите через 15 минут." }, 429, env, origin);
  const body = await readJson(request);
  const supplied = typeof body.password === "string" ? body.password : "";
  const [actualHash, expectedHash] = await Promise.all([sha256(supplied), sha256(env.FAMILY_PASSWORD)]);
  const valid = equals(actualHash, expectedHash) && supplied.length > 0;
  if (!valid) {
    if (!row || now - row.first_attempt_ms >= 15 * 60 * 1000) {
      await env.DB.prepare("INSERT INTO login_attempts(key, attempts, first_attempt_ms) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=1, first_attempt_ms=excluded.first_attempt_ms").bind(key, now).run();
    } else {
      await env.DB.prepare("UPDATE login_attempts SET attempts=attempts+1 WHERE key=?").bind(key).run();
    }
    return response({ error: "Неверный пароль" }, 401, env, origin);
  }
  await env.DB.prepare("DELETE FROM login_attempts WHERE key=?").bind(key).run();
  return response({ token: await makeToken(env.SESSION_SECRET), expires_in: SESSION_SECONDS }, 200, env, origin);
}
const worker = {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (!env.DB || !env.SESSION_SECRET || !env.FAMILY_PASSWORD || !env.ALLOWED_ORIGIN) {
      return response({ error: "Не настроены секреты или база данных API" }, 503, env, origin);
    }
    if (origin && origin !== env.ALLOWED_ORIGIN) return response({ error: "Недопустимый источник запроса" }, 403, env, null);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(env, origin) });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    if (path === "/health" && request.method === "GET") return response({ ok: true }, 200, env, origin);
    try {
      if (path === "/login" && request.method === "POST") return await login(request, env, origin);
      if (path === "/rpc" && request.method === "POST") {
        // A text/plain JSON envelope avoids the browser's extra CORS preflight.
        // The bearer token remains in the TLS-protected request body, never a URL.
        const body = await readJson(request);
        if (!(await tokenValid(body?.token, env.SESSION_SECRET))) {
          return response({ error: "Необходим вход в приложение" }, 401, env, origin);
        }
        if (body.action === "snapshot") {
          const [entries, configuredShares] = await Promise.all([
            env.DB.prepare("SELECT * FROM transactions ORDER BY date DESC, created_at DESC LIMIT 5000").all(),
            env.DB.prepare("SELECT person,basis_points FROM profit_shares").all(),
          ]);
          return response({ transactions: entries.results, shares: configuredShares.results }, 200, env, origin);
        }
        if (body.action === "create") {
          const error = validateEntry(body.entry);
          if (error) return response({ error }, 400, env, origin);
          const id = body.id;
          if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            return response({ error: "Некорректный идентификатор операции" }, 400, env, origin);
          }
          const entry = body.entry;
          await env.DB.prepare("INSERT OR IGNORE INTO transactions(id,date,type,person,amount_cents,category,comment) VALUES (?,?,?,?,?,?,?)")
            .bind(id, entry.date, entry.type, entry.person, entry.amount_cents, entry.category.trim(), entry.comment.trim()).run();
          return response({ id }, 200, env, origin);
        }
        if (body.action === "edit") {
          const error = validateEntry(body.entry);
          if (error) return response({ error }, 400, env, origin);
          if (typeof body.id !== "string" || !/^[a-f0-9-]{36}$/i.test(body.id)) return response({ error: "Некорректный ID" }, 400, env, origin);
          const entry = body.entry;
          const result = await env.DB.prepare("UPDATE transactions SET date=?,type=?,person=?,amount_cents=?,category=?,comment=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .bind(entry.date, entry.type, entry.person, entry.amount_cents, entry.category.trim(), entry.comment.trim(), body.id).run();
          return result.meta.changes ? response({ ok: true }, 200, env, origin) : response({ error: "Операция не найдена" }, 404, env, origin);
        }
        if (body.action === "delete") {
          if (typeof body.id !== "string" || !/^[a-f0-9-]{36}$/i.test(body.id)) return response({ error: "Некорректный ID" }, 400, env, origin);
          await env.DB.prepare("DELETE FROM transactions WHERE id=?").bind(body.id).run();
          return response({ ok: true }, 200, env, origin);
        }
        if (body.action === "shares") {
          if (!Array.isArray(body.shares) || body.shares.length !== 4) return response({ error: "Укажите четыре доли" }, 400, env, origin);
          const byPerson = new Map();
          for (const item of body.shares) {
            if (!PEOPLE.includes(item?.person) || byPerson.has(item.person) || !Number.isInteger(item.basis_points) || item.basis_points < 0 || item.basis_points > 10000) {
              return response({ error: "Некорректные доли" }, 400, env, origin);
            }
            byPerson.set(item.person, item.basis_points);
          }
          if ([...byPerson.values()].reduce((sum, points) => sum + points, 0) !== 10000) return response({ error: "Сумма долей должна составлять 100%" }, 400, env, origin);
          await env.DB.batch(PEOPLE.map((person) => env.DB.prepare("UPDATE profit_shares SET basis_points=? WHERE person=?").bind(byPerson.get(person), person)));
          return response({ ok: true }, 200, env, origin);
        }
        return response({ error: "Неизвестная операция" }, 400, env, origin);
      }

      const token = (request.headers.get("Authorization") || "").replace(/^Bearer /i, "");
      if (!(await tokenValid(token, env.SESSION_SECRET))) return response({ error: "Необходим вход в приложение" }, 401, env, origin);
      if (path === "/transactions" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM transactions ORDER BY date DESC, created_at DESC LIMIT 5000").all();
        return response({ transactions: results }, 200, env, origin);
      }
      if (path === "/transactions" && request.method === "POST") {
        const body = await readJson(request);
        const error = validateEntry(body);
        if (error) return response({ error }, 400, env, origin);
        const id = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO transactions(id,date,type,person,amount_cents,category,comment) VALUES (?,?,?,?,?,?,?)")
          .bind(id, body.date, body.type, body.person, body.amount_cents, body.category.trim(), body.comment.trim()).run();
        return response({ id }, 201, env, origin);
      }
      const match = path.match(/^\/transactions\/([a-f0-9-]{36})$/i);
      if (match && request.method === "PATCH") {
        const body = await readJson(request);
        const error = validateEntry(body);
        if (error) return response({ error }, 400, env, origin);
        const result = await env.DB.prepare("UPDATE transactions SET date=?,type=?,person=?,amount_cents=?,category=?,comment=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
          .bind(body.date, body.type, body.person, body.amount_cents, body.category.trim(), body.comment.trim(), match[1]).run();
        return result.meta.changes ? response({ ok: true }, 200, env, origin) : response({ error: "Операция не найдена" }, 404, env, origin);
      }
      if (match && request.method === "DELETE") {
        const result = await env.DB.prepare("DELETE FROM transactions WHERE id=?").bind(match[1]).run();
        return result.meta.changes ? response({ ok: true }, 200, env, origin) : response({ error: "Операция не найдена" }, 404, env, origin);
      }
      if (path === "/shares" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT person,basis_points FROM profit_shares").all();
        return response({ shares: results }, 200, env, origin);
      }
      if (path === "/shares" && request.method === "PUT") {
        const body = await readJson(request);
        if (!Array.isArray(body.shares) || body.shares.length !== 4) return response({ error: "Укажите четыре доли" }, 400, env, origin);
        const byPerson = new Map();
        for (const item of body.shares) {
          if (!PEOPLE.includes(item?.person) || byPerson.has(item.person) || !Number.isInteger(item.basis_points) || item.basis_points < 0 || item.basis_points > 10000) {
            return response({ error: "Некорректные доли" }, 400, env, origin);
          }
          byPerson.set(item.person, item.basis_points);
        }
        if (PEOPLE.some((p) => !byPerson.has(p)) || [...byPerson.values()].reduce((a, b) => a + b, 0) !== 10000) {
          return response({ error: "Сумма долей должна составлять 100%" }, 400, env, origin);
        }
        await env.DB.batch(PEOPLE.map((person) => env.DB.prepare("UPDATE profit_shares SET basis_points=? WHERE person=?").bind(byPerson.get(person), person)));
        return response({ ok: true }, 200, env, origin);
      }
      return response({ error: "Маршрут не найден" }, 404, env, origin);
    } catch (error) {
      if (error instanceof SyntaxError) return response({ error: "Некорректный JSON" }, 400, env, origin);
      if (error instanceof Error && error.message === "Размер запроса превышен") return response({ error: error.message }, 413, env, origin);
      console.error("API error", error);
      return response({ error: "Ошибка сервера" }, 500, env, origin);
    }
  },
};

export default worker;
