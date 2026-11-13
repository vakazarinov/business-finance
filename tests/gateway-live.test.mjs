import test from "node:test";
import assert from "node:assert/strict";

const api = "https://vzfpcwfasnqpuzezkbbh.supabase.co/functions/v1/finance-direct";
const origin = "https://vakazarinov.github.io";

test("direct Supabase API health responds without Cloudflare", async () => {
  const response = await fetch(api + "?check=health", {
    headers: { Origin: origin }, signal: AbortSignal.timeout(7500),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.backend, "supabase-direct");
  assert.equal(data.ok, true);
});

test("unauthenticated finance access is rejected by direct Supabase", async () => {
  const response = await fetch(api, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "snapshot", token: "invalid-token" }),
    signal: AbortSignal.timeout(7500),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
  assert.match((await response.json()).error, /Необходим вход/);
});

test("direct Supabase API rejects foreign origins", async () => {
  const response = await fetch(api, {
    method: "POST",
    headers: { Origin: "https://untrusted.example", "Content-Type": "text/plain" },
    body: JSON.stringify({ action: "snapshot", token: "invalid-token" }),
    signal: AbortSignal.timeout(7500),
  });
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});
