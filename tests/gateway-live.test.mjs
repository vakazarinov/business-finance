import test from "node:test";
import assert from "node:assert/strict";

const gateway = "https://vzfpcwfasnqpuzezkbbh.supabase.co/functions/v1/finance-gateway";
const site = "https://vakazarinov.github.io";

test("Supabase gateway reaches Cloudflare without accessing user data", async () => {
  const health = await fetch(gateway + "?check=health", {
    method: "GET",
    headers: { Origin: site },
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(health.status, 200, "gateway health endpoint should reach upstream");
  assert.equal((await health.json()).ok, true);
});

test("Supabase gateway forwards authentication rejection and CORS", async () => {
  const rejected = await fetch(gateway, {
    method: "POST",
    headers: { Origin: site, "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "snapshot", token: "invalid-test-token" }),
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(rejected.status, 401, "invalid token must be rejected by real Worker");
  assert.equal(rejected.headers.get("access-control-allow-origin"), site);
  const json = await rejected.json();
  assert.match(json.error, /Необходим вход/);
});

test("Supabase gateway rejects requests from other browser origins", async () => {
  const rejected = await fetch(gateway, {
    method: "POST",
    headers: { Origin: "https://untrusted.example", "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "snapshot", token: "invalid" }),
    signal: AbortSignal.timeout(8000),
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("access-control-allow-origin"), null);
});
