"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Person = "Витя" | "Маша" | "Петя" | "Саша";
type EntryType = "income" | "expense";
type Transaction = {
  id: string;
  date: string;
  type: EntryType;
  person: Person;
  amount_cents: number;
  category: string;
  comment: string;
  created_at: string;
};
type Share = { person: Person; basis_points: number };
type FormData = { date: string; type: EntryType; person: Person; amount: string; category: string; comment: string };
const PEOPLE: Person[] = ["Витя", "Маша", "Петя", "Саша"];
const API_URL = (process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
const RUB = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const formatRub = (kopeks: number) => RUB.format(kopeks / 100);
const dateToday = () => {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
};
const initialForm = (): FormData => ({ date: dateToday(), type: "expense", person: "Витя", amount: "", category: "", comment: "" });
function previousMonth() {
  const now = new Date();
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  const last = new Date(year, month, 0).getDate();
  return { from: `${year}-${String(month).padStart(2, "0")}-01`, to: `${year}-${String(month).padStart(2, "0")}-${last}` };
}
function amountToCents(input: string): number | null {
  const clean = input.trim().replace(",", ".");
  if (!/^(?:\d{1,9})(?:\.\d{1,2})?$/.test(clean)) return null;
  const [whole, cents = ""] = clean.split(".");
  const value = Number(whole) * 100 + Number(cents.padEnd(2, "0"));
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
async function api<T>(path: string, token: string | null, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(API_URL + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(method === "GET" ? 45000 : 20000),
  });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(`${path}: ${data.error || "Ошибка соединения"}`);
  return data;
}
function allocateProfit(profit: number, shares: Share[]) {
  // Allocate integer kopeks exactly; the last participant receives the rounding remainder.
  let allocated = 0;
  const result = new Map<Person, number>();
  PEOPLE.forEach((person, index) => {
    const points = shares.find((s) => s.person === person)?.basis_points || 0;
    const cents = index === PEOPLE.length - 1 ? profit - allocated : Math.round((profit * points) / 10000);
    result.set(person, cents);
    allocated += cents;
  });
  return result;
}

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [dataStatus, setDataStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [dataError, setDataError] = useState("");
  const [message, setMessage] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [shares, setShares] = useState<Share[]>(PEOPLE.map((person) => ({ person, basis_points: 2500 })));
  const [form, setForm] = useState<FormData>(initialForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [period, setPeriod] = useState<"previous" | "custom" | "all">("previous");
  const [dates, setDates] = useState(previousMonth);
  const [tab, setTab] = useState<"summary" | "entries" | "shares">("summary");
  const [shareDraft, setShareDraft] = useState<Record<Person, string>>({ "Витя": "25", "Маша": "25", "Петя": "25", "Саша": "25" });

  const refresh = useCallback(async (authToken: string) => {
    setDataStatus("loading");
    setDataError("");
    const results = await Promise.allSettled([
      api<{ transactions: Transaction[] }>("/transactions", authToken),
      api<{ shares: Share[] }>("/shares", authToken),
    ]);
    const [entriesResult, sharesResult] = results;
    if (entriesResult.status === "fulfilled") {
      setTransactions(entriesResult.value.transactions);
      setDataStatus("ready");
    } else {
      setDataStatus("error");
    }
    if (sharesResult.status === "fulfilled") {
      setShares(sharesResult.value.shares);
      const draft = {} as Record<Person, string>;
      for (const share of sharesResult.value.shares) draft[share.person] = String(share.basis_points / 100);
      setShareDraft(draft);
    }
    const failures = results.flatMap((result, index) => result.status === "rejected"
      ? [`${index === 0 ? "Операции" : "Доли"}: ${result.reason instanceof Error ? result.reason.message : "нет ответа"}`]
      : []);
    if (failures.length) {
      setDataError(failures.join("; "));
      throw new Error(failures.join("; "));
    }
  }, []);

  useEffect(() => {
    if (!API_URL) return;
    const saved = window.sessionStorage.getItem("finance_session");
    if (!saved) return;
    const handle = window.setTimeout(() => {
      setToken(saved);
      refresh(saved).catch((error) => {
        if (error instanceof Error && error.message.includes("Необходим вход")) {
          window.sessionStorage.removeItem("finance_session");
          setToken(null);
        } else {
          setMessage(error instanceof Error ? error.message : "Не удалось обновить данные");
        }
      });
    }, 0);
    return () => window.clearTimeout(handle);
  }, [refresh]);

  const filtered = useMemo(() => transactions.filter((entry) => period === "all" || (entry.date >= dates.from && entry.date <= dates.to)), [transactions, period, dates]);
  const totalIncome = filtered.filter((entry) => entry.type === "income").reduce((sum, entry) => sum + entry.amount_cents, 0);
  const totalExpenses = filtered.filter((entry) => entry.type === "expense").reduce((sum, entry) => sum + entry.amount_cents, 0);
  const profit = totalIncome - totalExpenses;
  const allocations = allocateProfit(profit, shares);
  const balances = PEOPLE.map((person) => {
    const own = filtered.filter((entry) => entry.person === person).reduce((sum, entry) => sum + (entry.type === "income" ? entry.amount_cents : -entry.amount_cents), 0);
    const target = allocations.get(person) || 0;
    return { person, own, target, difference: own - target };
  });

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true); setMessage("");
    try {
      const result = await api<{ token: string }>("/login", null, "POST", { password });
      window.sessionStorage.setItem("finance_session", result.token);
      setToken(result.token); setPassword("");
      try {
        await refresh(result.token);
      } catch (error) {
        setMessage(`Вход выполнен, но загрузка данных не удалась: ${error instanceof Error ? error.message : "Ошибка соединения"}`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Ошибка входа"); }
    finally { setLoading(false); }
  }
  function signOut() {
    window.sessionStorage.removeItem("finance_session");
    setToken(null); setTransactions([]); setDataStatus("idle"); setDataError(""); setTab("summary");
  }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || loading || dataStatus !== "ready") return;
    const amount_cents = amountToCents(form.amount);
    if (!amount_cents) { setMessage("Укажите положительную сумму, не более двух знаков после запятой"); return; }
    setLoading(true); setMessage("");
    try {
      const payload = { date: form.date, type: form.type, person: form.person, amount_cents, category: form.category, comment: form.comment };
      if (editingId) {
        await api(`/transactions/${editingId}`, token, "PATCH", payload);
        const id = editingId;
        setTransactions((previous) => previous.map((entry) => entry.id === id ? { ...entry, ...payload } : entry));
      } else {
        const result = await api<{ id: string }>("/transactions", token, "POST", payload);
        const entry: Transaction = { id: result.id, ...payload, created_at: new Date().toISOString() };
        setTransactions((previous) => [entry, ...previous].sort((x, y) =>
          y.date.localeCompare(x.date) || y.created_at.localeCompare(x.created_at)));
      }
      setForm(initialForm()); setEditingId(null); setMessage("Операция сохранена в базе");
    } catch (error) {
      setMessage(`Не удалось подтвердить сохранение: ${error instanceof Error ? error.message : "Ошибка соединения"}. Перед повторной отправкой обновите страницу и проверьте историю: операция могла сохраниться.`);
    }
    finally { setLoading(false); }
  }
  function edit(entry: Transaction) {
    setEditingId(entry.id);
    setForm({ date: entry.date, type: entry.type, person: entry.person, amount: String(entry.amount_cents / 100), category: entry.category, comment: entry.comment });
    setTab("entries"); setMessage("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function remove(entry: Transaction) {
    if (!token || loading || dataStatus !== "ready" || !window.confirm(`Удалить операцию «${entry.category || entry.type}» на ${formatRub(entry.amount_cents)}?`)) return;
    setLoading(true); setMessage("");
    try {
      await api(`/transactions/${entry.id}`, token, "DELETE");
      setTransactions((previous) => previous.filter((item) => item.id !== entry.id));
      setMessage("Операция удалена из базы");
    } catch (error) { setMessage(`Не удалось подтвердить удаление: ${error instanceof Error ? error.message : "Ошибка удаления"}. Проверьте историю после обновления страницы.`); }
    finally { setLoading(false); }
  }
  async function saveShares() {
    if (!token || loading || dataStatus !== "ready") return;
    const updated = PEOPLE.map((person) => ({ person, basis_points: Math.round(Number(shareDraft[person]) * 100) }));
    if (updated.some((share) => !Number.isFinite(share.basis_points) || share.basis_points < 0 || share.basis_points > 10000 || !/^\d+(?:[.,]\d{1,2})?$/.test(shareDraft[share.person].replace(",", "."))) || updated.reduce((sum, share) => sum + share.basis_points, 0) !== 10000) {
      setMessage("Укажите доли с точностью до 0,01%, в сумме ровно 100%"); return;
    }
    setLoading(true); setMessage("");
    try {
      await api("/shares", token, "PUT", { shares: updated });
      setShares(updated);
      setMessage("Доли обновлены в базе");
    } catch (error) { setMessage(`Не удалось подтвердить изменение долей: ${error instanceof Error ? error.message : "Ошибка соединения"}. Проверьте доли после обновления страницы.`); }
    finally { setLoading(false); }
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 pb-16 pt-7 sm:px-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div><p className="text-sm text-slate-500">Семейный проект</p><h1 className="text-3xl font-bold tracking-tight">Business Finance</h1></div>
        {token && <button onClick={signOut} className="rounded-xl border border-slate-300 px-3 py-2 text-sm">Выйти</button>}
      </header>

      {!API_URL ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-xl font-bold text-amber-950">Ожидается подключение базы</h2>
          <p className="mt-2 text-sm text-amber-900">Интерфейс опубликован, но API Cloudflare ещё не настроен. Для безопасной работы с общей базой нужно указать NEXT_PUBLIC_API_URL при сборке GitHub Pages.</p>
        </div>
      ) : !token ? (
        <form onSubmit={signIn} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="mb-2 text-xl font-bold">Вход для семьи</h2>
          <p className="mb-4 text-sm text-slate-500">Один общий пароль. Он проверяется на сервере, а не на GitHub Pages.</p>
          <label htmlFor="password" className="mb-2 block text-sm font-medium">Пароль</label>
          <input id="password" type="password" required autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mb-4 w-full rounded-xl border border-slate-300 p-3" />
          <button type="submit" disabled={loading} className="w-full rounded-xl bg-slate-900 p-3 font-semibold text-white disabled:opacity-50">{loading ? "Проверяем..." : "Войти"}</button>
          {message && <p role="alert" className="mt-3 text-sm text-rose-700">{message}</p>}
        </form>
      ) : (
        <>
          <nav aria-label="Разделы" className="mb-5 grid grid-cols-3 gap-2">
            {([{ key: "summary", title: "Сводка" }, { key: "entries", title: "Операции" }, { key: "shares", title: "Доли" }] as const).map((item) => (
              <button key={item.key} onClick={() => { setTab(item.key); setMessage(""); }} className={`rounded-xl px-2 py-3 text-sm font-semibold ${tab === item.key ? "bg-slate-900 text-white" : "bg-white text-slate-700"}`}>{item.title}</button>
            ))}
          </nav>
          {dataStatus === "loading" && <p role="status" className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">Загружаем финансовые данные из базы. Ранее сохранённые операции не удалены.</p>}
          {dataStatus === "error" && <div role="alert" className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Не удалось загрузить историю. Это не означает, что записи удалены.</p>
            <p className="mt-1 break-words">{dataError}</p>
            <button type="button" disabled={loading} onClick={() => token && refresh(token).catch(() => {})} className="mt-3 rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-50">Повторить загрузку</button>
          </div>}
          {message && dataStatus !== "error" && <p role="status" className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
          {tab === "summary" && (
            <>
              <section className="mb-5 rounded-2xl bg-white p-4">
                <label htmlFor="period" className="mb-2 block text-sm font-semibold">Период расчёта</label>
                <select id="period" value={period} onChange={(event) => setPeriod(event.target.value as typeof period)} className="w-full rounded-xl border border-slate-300 p-3">
                  <option value="previous">Предыдущий месяц</option><option value="custom">Произвольный период</option><option value="all">Вся история</option>
                </select>
                {period === "custom" && <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="text-xs">С<input aria-label="С даты" type="date" value={dates.from} onChange={(event) => setDates({ ...dates, from: event.target.value })} className="mt-1 w-full rounded-xl border p-2" /></label>
                  <label className="text-xs">По<input aria-label="По дату" type="date" value={dates.to} onChange={(event) => setDates({ ...dates, to: event.target.value })} className="mt-1 w-full rounded-xl border p-2" /></label>
                </div>}
              </section>
              {dataStatus === "ready" ? <section className="mb-5 rounded-3xl bg-slate-900 p-6 text-white">
                <p className="text-sm text-slate-300">Прибыль</p><p className="mt-1 text-4xl font-bold">{formatRub(profit)}</p>
                <div className="mt-5 grid grid-cols-2 gap-4">
                  <div><p className="text-xs text-slate-300">Доходы</p><p className="font-semibold">{formatRub(totalIncome)}</p></div>
                  <div><p className="text-xs text-slate-300">Расходы</p><p className="font-semibold">{formatRub(totalExpenses)}</p></div>
                </div>
              </section> : <section className="mb-5 rounded-3xl bg-slate-900 p-6 text-white"><p className="text-sm">Сводка будет доступна после загрузки операций</p></section>}
              {dataStatus === "ready" && <section className="mb-5 rounded-2xl bg-white p-5">
                <h2 className="mb-1 text-lg font-bold">Взаиморасчёты</h2>
                <p className="mb-4 text-xs text-slate-500">Положительное сальдо — должен передать другим; отрицательное — должен получить. Переводы погашения пока не учитываются.</p>
                {balances.map((item) => <div key={item.person} className="border-b border-slate-100 py-3 last:border-0">
                  <div className="flex justify-between"><strong>{item.person}</strong><strong className={item.difference > 0 ? "text-rose-700" : item.difference < 0 ? "text-emerald-700" : ""}>{item.difference > 0 ? "Передать " : item.difference < 0 ? "Получить " : "Расчёт "}{formatRub(Math.abs(item.difference))}</strong></div>
                  <p className="mt-1 text-xs text-slate-500">Фактически {formatRub(item.own)} · Доля прибыли {formatRub(item.target)}</p>
                </div>)}
              </section>}
            </>
          )}
          {tab === "entries" && (
            <section className="mb-5 rounded-2xl bg-white p-5">
              <h2 className="mb-4 text-lg font-bold">{editingId ? "Изменить операцию" : "Новая операция"}</h2>
              <form onSubmit={save} className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  {(["income", "expense"] as const).map((type) => <button key={type} type="button" onClick={() => setForm({ ...form, type })} className={`rounded-xl border p-3 font-medium ${form.type === type ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300"}`}>{type === "income" ? "Доход" : "Расход"}</button>)}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm">Дата<input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
                  <label className="text-sm">Участник<select value={form.person} onChange={(event) => setForm({ ...form, person: event.target.value as Person })} className="mt-1 w-full rounded-xl border border-slate-300 p-3">{PEOPLE.map((person) => <option key={person}>{person}</option>)}</select></label>
                </div>
                <label className="block text-sm">Сумма, ₽<input required inputMode="decimal" placeholder="3500" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
                <label className="block text-sm">Категория<input maxLength={80} placeholder="Например, реклама" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
                <label className="block text-sm">Комментарий (необязательно)<input maxLength={500} value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} className="mt-1 w-full rounded-xl border border-slate-300 p-3" /></label>
                <button type="submit" disabled={loading || dataStatus !== "ready"} className="w-full rounded-xl bg-slate-900 p-3 font-semibold text-white disabled:opacity-50">{loading ? "Сохраняем..." : dataStatus !== "ready" ? "Сначала загрузите историю" : editingId ? "Сохранить изменения" : "Добавить операцию"}</button>
                {editingId && <button type="button" onClick={() => { setEditingId(null); setForm(initialForm()); }} className="w-full rounded-xl border p-3">Отменить редактирование</button>}
              </form>
            </section>
          )}
          {tab === "shares" && (
            <section className="mb-5 rounded-2xl bg-white p-5">
              <h2 className="mb-2 text-lg font-bold">Доли участников</h2>
              <p className="mb-4 text-sm text-slate-500">Все доли должны суммироваться в 100%. Изменение пересчитывает и исторические периоды — фиксацию долей по месяцам добавим отдельно.</p>
              {PEOPLE.map((person) => <label key={person} className="mb-3 flex items-center justify-between gap-3 text-sm"><span>{person}</span><span className="flex items-center gap-2"><input inputMode="decimal" value={shareDraft[person] || ""} onChange={(event) => setShareDraft({ ...shareDraft, [person]: event.target.value })} className="w-24 rounded-lg border border-slate-300 p-2 text-right" />%</span></label>)}
              <button disabled={loading || dataStatus !== "ready"} onClick={saveShares} className="w-full rounded-xl bg-slate-900 p-3 font-semibold text-white disabled:opacity-50">Сохранить доли</button>
            </section>
          )}
          <section className="rounded-2xl bg-white p-5">
            <div className="mb-4 flex items-center justify-between gap-2"><h2 className="text-lg font-bold">Последние операции</h2><span className="text-xs text-slate-500">До 10</span></div>
            {dataStatus !== "ready" ? <p className="text-sm text-amber-800">{dataStatus === "loading" ? "Загружаем операции из базы..." : "История сейчас недоступна. Записи в базе не удалены; используйте «Повторить загрузку»."}</p> : transactions.length === 0 ? <p className="text-sm text-slate-500">В базе пока нет операций. Добавь первую во вкладке «Операции».</p> :
              transactions.slice(0, 10).map((entry) => <div key={entry.id} className="border-b border-slate-100 py-3 last:border-0">
                <div className="flex justify-between gap-3"><div><strong>{entry.category || (entry.type === "income" ? "Доход" : "Расход")}</strong><p className="text-xs text-slate-500">{entry.person} · {entry.date}</p>{entry.comment && <p className="text-xs text-slate-500">{entry.comment}</p>}</div><strong className={entry.type === "income" ? "text-emerald-700" : ""}>{entry.type === "income" ? "+" : "−"}{formatRub(entry.amount_cents)}</strong></div>
                <div className="mt-2 flex gap-4 text-sm"><button disabled={loading || dataStatus !== "ready"} onClick={() => edit(entry)} className="text-blue-700 disabled:opacity-50">Изменить</button><button disabled={loading || dataStatus !== "ready"} onClick={() => remove(entry)} className="text-rose-700">Удалить</button></div>
              </div>)}
          </section>
          <p className="mt-6 text-center text-xs text-slate-500">Финансовые данные хранятся в Cloudflare D1, а не на GitHub Pages.</p>
        </>
      )}
    </main>
  );
}
