"use client";

import { useMemo, useState } from "react";

type Person = "Витя" | "Маша" | "Петя" | "Саша";
type EntryType = "income" | "expense";
type Entry = {
  id: number;
  date: string;
  person: Person;
  type: EntryType;
  amount: number;
  category: string;
};

const people: Person[] = ["Витя", "Маша", "Петя", "Саша"];
const examples: Entry[] = [
  { id: 1, date: "2026-10-28", person: "Витя", type: "income", amount: 32000, category: "Аренда" },
  { id: 2, date: "2026-10-27", person: "Маша", type: "expense", amount: 3500, category: "Реклама" },
  { id: 3, date: "2026-10-25", person: "Петя", type: "expense", amount: 2800, category: "Хозяйственные расходы" },
  { id: 4, date: "2026-10-23", person: "Саша", type: "income", amount: 28000, category: "Аренда" },
];

const money = (amount: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);

export default function Home() {
  const [period, setPeriod] = useState<"previous" | "all">("previous");
  const [entries] = useState<Entry[]>(examples);

  const visible = useMemo(() => {
    if (period === "all") return entries;
    // Demo data has a fixed illustrative period until the shared API is connected.
    return entries;
  }, [period, entries]);

  const income = visible.filter((entry) => entry.type === "income").reduce((total, entry) => total + entry.amount, 0);
  const expenses = visible.filter((entry) => entry.type === "expense").reduce((total, entry) => total + entry.amount, 0);
  const profit = income - expenses;

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 pb-12 pt-8 sm:px-6">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">Семейный проект</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Business Finance</h1>
          <p className="mt-2 text-sm text-slate-500">Доходы, расходы и взаиморасчёты</p>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">Демо</span>
      </header>

      <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>Предварительная версия интерфейса.</strong> Сейчас показаны только вымышленные примеры.
        Данные не сохраняются и пока не синхронизируются между участниками.
        В следующем этапе подключим защищённый API и общую базу Cloudflare D1.
      </div>

      <section className="mb-6">
        <label htmlFor="period" className="mb-2 block text-sm font-semibold">Период</label>
        <select
          id="period"
          className="w-full rounded-xl border border-slate-300 bg-white p-3 text-slate-900"
          value={period}
          onChange={(event) => setPeriod(event.target.value as "previous" | "all")}
        >
          <option value="previous">Предыдущий месяц (демо)</option>
          <option value="all">Вся история (демо)</option>
        </select>
      </section>

      <section className="mb-6 rounded-3xl bg-slate-900 p-6 text-white">
        <p className="text-sm text-slate-300">Прибыль</p>
        <p className="mt-1 text-4xl font-bold">{money(profit)}</p>
        <div className="mt-6 grid grid-cols-2 gap-4">
          <div><p className="text-xs text-slate-300">Доходы</p><p className="mt-1 text-lg font-semibold">{money(income)}</p></div>
          <div><p className="text-xs text-slate-300">Расходы</p><p className="mt-1 text-lg font-semibold">{money(expenses)}</p></div>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Доли прибыли</h2>
        <p className="mt-1 text-sm text-slate-500">Пока по 25% каждому</p>
        <div className="mt-4 space-y-3">
          {people.map((person) => (
            <div key={person} className="flex items-center justify-between border-b border-slate-100 pb-3 last:border-0 last:pb-0">
              <span>{person}</span>
              <span className="font-semibold">{money(profit / people.length)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">Последние операции</h2>
          <span className="text-xs text-slate-500">Примеры</span>
        </div>
        <div className="space-y-4">
          {visible.slice(0, 10).map((entry) => (
            <div key={entry.id} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3 last:border-0 last:pb-0">
              <div>
                <p className="font-medium">{entry.category}</p>
                <p className="mt-1 text-xs text-slate-500">{entry.person} · {entry.date}</p>
              </div>
              <p className={`whitespace-nowrap font-semibold ${entry.type === "income" ? "text-emerald-700" : "text-slate-700"}`}>
                {entry.type === "income" ? "+" : "−"}{money(entry.amount)}
              </p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
