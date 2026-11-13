"use client";

import { useEffect, useState } from "react";

type Probe = { target: string; run: number; milliseconds: number; status: number | null; error?: string };
const API = "https://vzfpcwfasnqpuzezkbbh.supabase.co/functions/v1/finance-direct";
const ROUNDS = 10;

function summarize(items: Probe[], target: string) {
  const rows = items.filter((item) => item.target === target);
  const successes = rows.filter((item) => item.status === 200);
  const times = successes.map((item) => item.milliseconds).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor((times.length - 1) / 2)] : null;
  return { total: rows.length, success: successes.length, median, maximum: times.length ? Math.max(...times) : null };
}

export default function Diagnostics() {
  const [results, setResults] = useState<Probe[]>([]);
  const [running, setRunning] = useState(false);
  const [finished, setFinished] = useState(false);

  async function run() {
    setResults([]);
    setFinished(false);
    setRunning(true);
    const measured: Probe[] = [];
    const endpoints = [
      { target: "GitHub Pages", url: window.location.origin + "/business-finance/" },
      { target: "Supabase Edge", url: "https://vzfpcwfasnqpuzezkbbh.supabase.co/functions/v1/network-check" },
      { target: "Supabase Finance API", url: API + "?check=health" },
    ];
    for (let i = 1; i <= ROUNDS; i++) {
      const batch = await Promise.all(endpoints.map(async ({ target, url }) => {
        const started = performance.now();
        try {
          const response = await fetch(url + "?probe=" + crypto.randomUUID(), {
            method: "GET", cache: "no-store", signal: AbortSignal.timeout(6000),
          });
          await response.text();
          return { target, run: i, milliseconds: Math.round(performance.now() - started), status: response.status };
        } catch (error) {
          return { target, run: i, milliseconds: Math.round(performance.now() - started),
            status: null, error: error instanceof Error ? error.name : "UnknownError" };
        }
      }));
      measured.push(...batch);
      setResults([...measured]);
    }
    setRunning(false);
    setFinished(true);
  }

  useEffect(() => {
    const id = window.setTimeout(() => { void run(); }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const page = summarize(results, "GitHub Pages");
  const finance = summarize(results, "Supabase Finance API");
  const supabase = summarize(results, "Supabase Edge");

  const report = [
    "Business Finance - проверка соединения",
    "Дата: " + new Date().toISOString(),
    "GitHub Pages: " + page.success + "/" + page.total + " успешно, медиана " + (page.median ?? "н/д") + " мс, максимум " + (page.maximum ?? "н/д") + " мс",
    "Supabase Finance API: " + finance.success + "/" + finance.total + " успешно, медиана " + (finance.median ?? "н/д") + " мс, максимум " + (finance.maximum ?? "н/д") + " мс",
    "Supabase Edge: " + supabase.success + "/" + supabase.total + " успешно, медиана " + (supabase.median ?? "н/д") + " мс, максимум " + (supabase.maximum ?? "н/д") + " мс",
    ...results.map((r) => r.target + " #" + r.run + ": " + (r.status ?? r.error) + " - " + r.milliseconds + " мс"),
  ].join("\n");

  return (
    <main className="mx-auto min-h-screen max-w-xl px-5 py-8">
      <a className="text-sm underline" href="/business-finance/">← Вернуться в Business Finance</a>
      <h1 className="mt-5 text-2xl font-bold">Проверка соединения</h1>
      <p className="mt-2 text-sm text-slate-600">
        Проверяем сайт и сервер финансового приложения непосредственно на Supabase. Ни пароли, ни финансовые данные не используются. Пароль, финансовые записи и токен авторизации не используются.
      </p>
      <p className="mt-4 rounded-xl bg-slate-100 p-3 text-sm" role="status">
        {running ? "Выполняем 10 серий измерений..." : finished ? "Проверка завершена" : "Подготовка проверки..."}
      </p>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[{ title: "GitHub Pages", data: page }, { title: "Supabase Edge", data: supabase }].map(({ title, data }) => (
          <section className="rounded-xl border border-slate-200 bg-white p-4" key={title}>
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-2xl font-bold">{data.median === null ? "—" : (data.median / 1000).toFixed(2) + " с"}</p>
            <p className="text-xs text-slate-500">Медиана успешных запросов</p>
            <p className="mt-2 text-sm">Успешно: {data.success} из {data.total}</p>
            <p className="text-sm">Максимум: {data.maximum === null ? "—" : (data.maximum / 1000).toFixed(2) + " с"}</p>
          </section>
        ))}
      </div>
      <div className="mt-4 rounded-xl border bg-white p-4">
        <h2 className="font-semibold">Подробные результаты</h2>
        <div className="mt-2 space-y-1 text-sm">
          {results.map((r) => (
            <p key={r.target + r.run}>{r.target} #{r.run}: {r.status ?? r.error} · {(r.milliseconds / 1000).toFixed(2)} с</p>
          ))}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" disabled={running} onClick={() => { void run(); }} className="rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">Повторить измерения</button>
        <button type="button" disabled={!finished} onClick={() => { void navigator.clipboard.writeText(report); }} className="rounded-xl border border-slate-300 bg-white px-4 py-3 font-semibold disabled:opacity-50">Скопировать результат</button>
      </div>
      <p className="mt-5 text-sm text-slate-500">Данные измерений не передаются в сторонние сервисы. Скопируй результат и пришли его в чат.</p>
    </main>
  );
}
