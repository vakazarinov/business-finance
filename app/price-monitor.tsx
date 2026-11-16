"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const API = "https://vzfpcwfasnqpuzezkbbh.supabase.co/functions/v1/finance-direct";
type Platform = "avito" | "sutochno" | "other";
type Property = { id: string; name: string; avito_markup_bp: number; deviation_bp: number; min_price_cents: number };
type Source = { id: string; property_id: string; platform: Platform; role: "own" | "competitor"; url: string; label: string };
type Observation = { id: string; source_id: string; stay_date: string; price_cents: number; collected_at: string; provenance: string };
type Snapshot = { properties: Property[]; sources: Source[]; observations: Observation[] };
type Recommendation = { date: string; current: number; market: number; suggested: number; deviation: number; count: number };
const money = (cents: number) => new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(Math.round(cents/100)) + " ₽";
const iso = (d: Date) => [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
const offsetDate = (days: number) => {const d = new Date();d.setDate(d.getDate()+days);return iso(d);};
const median = (values: number[]) => {const a=[...values].sort((x,y)=>x-y);return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2 : 0;};
function baseline(cents: number, platform: Platform, markupBp: number) {
  return platform === "avito" ? Math.round(cents / (1+markupBp/10000)) : cents;
}
async function request<T>(token:string, action:string, payload:Record<string,unknown>={}) {
  const response=await fetch(API,{method:"POST",headers:{"Content-Type":"text/plain"},body:JSON.stringify({action,token,...payload}),signal:AbortSignal.timeout(10000)});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || "Не удалось выполнить запрос");
  return data as T;
}
const platformNames:Record<Platform,string>={avito:"Авито",sutochno:"Суточно.ру",other:"Другой сайт"};
export default function PriceMonitor({token}:{token:string}) {
  const [data,setData]=useState<Snapshot>({properties:[],sources:[],observations:[]});
  const [selected,setSelected]=useState("");
  const [from,setFrom]=useState(()=>offsetDate(0));
  const [to,setTo]=useState(()=>offsetDate(30));
  const [propertyName,setPropertyName]=useState("");
  const [platform,setPlatform]=useState<Platform>("avito");
  const [role,setRole]=useState<"own"|"competitor">("competitor");
  const [url,setUrl]=useState("");
  const [label,setLabel]=useState("");
  const [sourceId,setSourceId]=useState("");
  const [quoteDate,setQuoteDate]=useState(()=>offsetDate(0));
  const [quoteAmount,setQuoteAmount]=useState("");
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [analyzed,setAnalyzed]=useState(false);
  const [minComp,setMinComp]=useState(3);
  const refresh=useCallback(async()=>{const result=await request<Snapshot>(token,"priceSnapshot");setData(result);setSelected(old=>result.properties.some(p=>p.id===old)?old:(result.properties[0]?.id||""));},[token]);
  useEffect(()=>{refresh().catch(e=>setMessage(e.message));},[refresh]);
  const property=data.properties.find(p=>p.id===selected);
  const sources=data.sources.filter(s=>s.property_id===selected);
  const activeSource=sources.find(s=>s.id===sourceId);
  const owned=sources.filter(s=>s.role==="own");
  const competitors=sources.filter(s=>s.role==="competitor");
  const analysis=useMemo(()=>{
    if(!property) return [] as {date:string;own:number|null;market:number|null;count:number;rec:Recommendation|null}[];
    const days=[] as {date:string;own:number|null;market:number|null;count:number;rec:Recommendation|null}[];
    if(!from||!to||to<from) return days;
    const start=new Date(from+"T00:00:00Z"),end=new Date(to+"T00:00:00Z");
    if((end.getTime()-start.getTime())/86400000>92) return days;
    for(let time=start.getTime();time<=end.getTime();time+=86400000){
      const date=new Date(time).toISOString().slice(0,10);
      const quotes=data.observations.filter(o=>o.stay_date===date);
      const bySource=(role:"own"|"competitor")=>quotes.flatMap(o=>{
        const src=sources.find(s=>s.id===o.source_id);
        return src?.role===role ? [baseline(o.price_cents,src.platform,property.avito_markup_bp)] : [];
      });
      const mine=bySource("own"), comp=bySource("competitor");
      const own=mine.length?Math.round(median(mine)):null,market=comp.length?Math.round(median(comp)):null;
      const enough=own!==null&&market!==null&&comp.length>=minComp&&market>0;
      const deviation=enough ? (own!-market!)/market! : 0;
      const recommended=enough && Math.abs(deviation)>=property.deviation_bp/10000;
      const rec:Recommendation|null=recommended?{
        date,current:own!,market:market!,suggested:Math.max(property.min_price_cents,Math.round(market!/10000)*10000),
        deviation,count:comp.length
      }:null;
      days.push({date,own,market,count:comp.length,rec});
    }
    return days;
  },[property,from,to,data.observations,sources,minComp]);
  const recommendations=analysis.flatMap(day=>day.rec?[day.rec]:[]);
  const withOwn=analysis.filter(day=>day.own!==null).length;
  const withMarket=analysis.filter(day=>day.market!==null).length;
  const chartDays=analysis.filter((_,index)=>analysis.length<=35||index%Math.max(1,Math.ceil(analysis.length/35))===0);
  const chartPrices=analysis.flatMap(x=>[x.own,x.market]).filter((x):x is number=>x!==null);
  const chartLow=chartPrices.length?Math.floor(Math.min(...chartPrices)*0.9/10000)*10000:0;
  const chartHigh=chartPrices.length?Math.ceil(Math.max(...chartPrices)*1.1/10000)*10000:10000;
  const chartH=220,chartW=720;
  const x=(index:number,length:number)=>46+(index/Math.max(1,length-1))*(chartW-62);
  const y=(value:number)=>chartH-22-(value-chartLow)/Math.max(1,chartHigh-chartLow)*(chartH-42);
  function segments(field:"own"|"market") {
    const chunks:string[]=[];let current:string[]=[];
    chartDays.forEach((day,i)=>{const price=day[field];if(price===null){if(current.length>1)chunks.push(current.join(" "));current=[];}else{current.push((current.length?"L":"M")+" "+x(i,chartDays.length).toFixed(1)+" "+y(price).toFixed(1));}});
    if(current.length>1)chunks.push(current.join(" "));
    return chunks;
  }
  async function mutate(action:string,payload:Record<string,unknown>,reset?:()=>void){
    setBusy(true);setMessage("");
    try{await request(token,action,payload);await refresh();reset?.();setAnalyzed(false);setMessage("Сохранено");}
    catch(e){setMessage(e instanceof Error?e.message:"Ошибка");}
    finally{setBusy(false);}
  }
  function runAnalysis(){
    if(!property){setMessage("Сначала добавьте объект");return;}
    if(to<from){setMessage("Дата окончания раньше начала");return;}
    if((new Date(to).getTime()-new Date(from).getTime())/86400000>92){setMessage("Максимальный период анализа — 93 дня");return;}
    setAnalyzed(true);setMessage("Рассчитано по подтверждённым наблюдениям. Новые цены с сайтов автоматически пока не получаются.");
  }
  const controls="mt-1 block h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900";
  return <div className="space-y-4 text-slate-900">
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-xl font-bold">Монитор цен</h2>
      <p className="mt-1 text-sm text-slate-600">Сравнение цен по датам на площадках и расчёт рекомендуемой базовой цены RealtyCalendar.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Объект
          <select className={controls} value={selected} onChange={e=>{setSelected(e.target.value);setAnalyzed(false);setSourceId("");}}>
            {!data.properties.length&&<option value="">Нет объектов</option>}
            {data.properties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Минимум конкурентов на дату
          <select className={controls} value={minComp} onChange={e=>{setMinComp(Number(e.target.value));setAnalyzed(false);}}>
            {[1,2,3,5,8].map(n=><option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium">Начало периода
          <input type="date" className={controls} value={from} onChange={e=>{setFrom(e.target.value);setAnalyzed(false);}}/>
        </label>
        <label className="text-sm font-medium">Конец периода
          <input type="date" className={controls} value={to} onChange={e=>{setTo(e.target.value);setAnalyzed(false);}}/>
        </label>
      </div>
      <button type="button" onClick={runAnalysis} disabled={!selected||busy}
        className="mt-4 min-h-12 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">
        Проанализировать выбранный период
      </button>
      <p className="mt-2 text-xs text-amber-800">Сейчас анализируются только цены с подтверждённой датой из базы. Автоматический сбор с Авито и Суточно.ру ещё не подключён — кнопка не имитирует проверку сайтов.</p>
      {message&&<p role="status" className="mt-3 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">{message}</p>}
    </section>

    <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer font-semibold">Настроить объекты и источники</summary>
      <div className="mt-4 space-y-4">
        <form onSubmit={e=>{e.preventDefault();if(propertyName.trim())mutate("priceAddProperty",{name:propertyName.trim()},()=>setPropertyName(""));}} className="space-y-2">
          <label className="block text-sm font-medium">Название нового апартамента
            <input required maxLength={120} className={controls} placeholder="Например, Авенир 408" value={propertyName} onChange={e=>setPropertyName(e.target.value)}/>
          </label>
          <button disabled={busy} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Добавить объект</button>
        </form>
        {property&&<form onSubmit={e=>{e.preventDefault();mutate("priceAddSource",{property_id:selected,platform,role,url,label},()=>{setUrl("");setLabel("");});}} className="space-y-3 border-t border-slate-200 pt-4">
          <p className="text-sm font-semibold">Добавить ссылку к объекту «{property.name}»</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Площадка
              <select className={controls} value={platform} onChange={e=>setPlatform(e.target.value as Platform)}>
                <option value="avito">Авито</option><option value="sutochno">Суточно.ру</option><option value="other">Другая</option>
              </select>
            </label>
            <label className="text-sm">Тип объявления
              <select className={controls} value={role} onChange={e=>setRole(e.target.value as "own"|"competitor")}>
                <option value="own">Моё</option><option value="competitor">Конкурент</option>
              </select>
            </label>
          </div>
          <label className="block text-sm">Ссылка на объявление
            <input type="url" required className={controls} placeholder="https://..." value={url} onChange={e=>setUrl(e.target.value)}/>
          </label>
          <label className="block text-sm">Подпись (необязательно)
            <input className={controls} maxLength={120} placeholder="Соседний дом, студия" value={label} onChange={e=>setLabel(e.target.value)}/>
          </label>
          <button disabled={busy} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Сохранить источник</button>
        </form>}
        {sources.length>0&&<div className="space-y-2 border-t border-slate-200 pt-3">
          <p className="text-sm font-semibold">Сохранённые источники ({sources.length})</p>
          {sources.map(src=><div key={src.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 p-3">
            <div className="min-w-0"><p className="text-sm font-medium">{src.role==="own"?"Моё":"Конкурент"} · {platformNames[src.platform]} {src.label&&"· "+src.label}</p>
              <a href={src.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-blue-700 underline">{src.url}</a>
            </div>
            <button type="button" disabled={busy} onClick={()=>{if(confirm("Удалить ссылку и её наблюдения?"))mutate("priceDeleteSource",{source_id:src.id});}} className="shrink-0 text-xs font-semibold text-rose-700">Удалить</button>
          </div>)}
        </div>}
      </div>
    </details>

    <details className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer font-semibold">Добавить проверенную цену за ночь</summary>
      <div className="mt-3 space-y-3">
        <p className="text-sm text-slate-600">Временный ручной ввод для тестирования расчётов. Вводите стоимость именно за выбранную дату, для одинакового числа гостей и условий проживания.</p>
        {!sources.length?<p className="text-sm text-amber-800">Сначала добавьте объявление в настройках выше.</p>:<form onSubmit={e=>{e.preventDefault();const price=Number(quoteAmount.replace(",","."));if(!Number.isFinite(price)||price<=0||!Number.isSafeInteger(Math.round(price*100)))return setMessage("Укажите корректную цену");mutate("pricePutObservation",{source_id:sourceId,stay_date:quoteDate,price_cents:Math.round(price*100)},()=>setQuoteAmount(""));}} className="space-y-3">
          <label className="block text-sm">Объявление
            <select className={controls} value={sourceId} required onChange={e=>setSourceId(e.target.value)}>
              <option value="">Выберите объявление</option>
              {sources.map(src=><option key={src.id} value={src.id}>{src.role==="own"?"Моё":"Конкурент"} · {platformNames[src.platform]} · {src.label||src.url.slice(0,40)}</option>)}
            </select>
          </label>
          {activeSource?.platform==="avito"&&<p className="text-xs text-blue-700">Цена Авито будет разделена на 1,18 для сравнения с RealtyCalendar.</p>}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Ночь
              <input className={controls} required type="date" value={quoteDate} onChange={e=>setQuoteDate(e.target.value)}/>
            </label>
            <label className="text-sm">Цена на сайте, ₽
              <input className={controls} required inputMode="decimal" placeholder="4500" value={quoteAmount} onChange={e=>setQuoteAmount(e.target.value)}/>
            </label>
          </div>
          <button disabled={busy||!sourceId} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Сохранить цену</button>
        </form>}
      </div>
    </details>

    {property&&<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="font-bold">Нормализация и условия сравнения</h3>
      <p className="mt-1 text-sm text-slate-600">Для Авито: опубликованная цена ÷ 1,18 = эквивалент цены RealtyCalendar. Например, 5 900 ₽ на Авито соответствуют 5 000 ₽ в RealtyCalendar. Для других площадок поправка сейчас нулевая; фактические комиссии и скидки требуют отдельной настройки.</p>
      <p className="mt-2 text-sm text-slate-600">Порог рекомендации: {property.deviation_bp/100}% отклонения от рыночной медианы; минимальная базовая цена: {money(property.min_price_cents)}.</p>
      <p className="mt-1 text-xs text-slate-500">Сравниваются только данные за одинаковую дату. Для полноценных рекомендаций нужны собственная цена и минимум {minComp} наблюдения конкурентов на эту ночь.</p>
      <p className="mt-2 text-xs text-slate-500">Источники для этого объекта: {owned.length} своих, {competitors.length} конкурентных.</p>
    </section>}

    {analyzed&&<section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h3 className="text-lg font-bold">Цены по датам — {property?.name}</h3>
      <p className="mt-1 text-xs text-slate-500">Базовая цена в RealtyCalendar, ₽/ночь. Синим — моя цена, зелёным — медиана конкурентов.</p>
      <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3">
        <div><p className="text-xs text-slate-500">Дней с моей ценой</p><p className="text-xl font-bold">{withOwn} / {analysis.length}</p></div>
        <div><p className="text-xs text-slate-500">Дней с данными рынка</p><p className="text-xl font-bold">{withMarket} / {analysis.length}</p></div>
      </div>
      {chartPrices.length>0?<div className="mt-3 w-full overflow-x-auto">
        <svg viewBox="0 0 720 248" role="img" aria-label="График моих и рыночных цен" className="min-w-[300px] w-full">
          {[0,0.5,1].map(level=>{const value=chartLow+(chartHigh-chartLow)*level;return <g key={level}>
            <line x1="45" x2="706" y1={y(value)} y2={y(value)} stroke="#e2e8f0" strokeWidth="1"/>
            <text x="2" y={y(value)+4} fontSize="12" fill="#64748b">{Math.round(value/100000)}к</text>
          </g>;})}
          {segments("own").map((d,i)=><path key={"o"+i} d={d} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round"/>)}
          {segments("market").map((d,i)=><path key={"m"+i} d={d} fill="none" stroke="#059669" strokeWidth="3" strokeLinecap="round"/>)}
          {chartDays.filter((_,i)=>i%Math.max(1,Math.floor(chartDays.length/5))===0).map(day=><text key={day.date} x={x(chartDays.indexOf(day),chartDays.length)} y="240" fontSize="12" textAnchor="middle" fill="#64748b">{day.date.slice(5)}</text>)}
        </svg>
        <div className="mt-1 flex gap-4 text-xs"><span className="text-blue-700">● Моя цена</span><span className="text-emerald-700">● Медиана рынка</span></div>
      </div>:<p className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Нет проверенных цен за этот период. График намеренно пуст — вымышленные цены не используются.</p>}
      <h4 className="mt-5 text-base font-bold">Рекомендации ({recommendations.length})</h4>
      {!recommendations.length?<p className="mt-2 text-sm text-slate-600">Пока рекомендаций нет. Причина: недостаточно сопоставимых цен на одни и те же даты либо отклонения меньше заданного порога.</p>:
        <div className="mt-3 space-y-2">{recommendations.map(rec=><div key={rec.date} className="rounded-xl border border-slate-200 p-3 text-sm">
          <p className="font-semibold">{rec.date}</p>
          <p className="mt-1">Моя база: {money(rec.current)} · Медиана рынка: {money(rec.market)}</p>
          <p className="mt-1 font-semibold text-blue-800">Рекомендация для RealtyCalendar: {money(rec.suggested)}</p>
          <p className="mt-1 text-xs text-slate-500">Отклонение: {(rec.deviation*100).toFixed(1)}% · Конкурентов: {rec.count}. На Авито цена после наценки: {money(Math.round(rec.suggested*1.18))}.</p>
        </div>)}</div>}
      <p className="mt-3 text-xs text-slate-500">Рекомендации не изменяют цены автоматически. Используйте их только после проверки релевантности конкурентов и доступности дат.</p>
    </section>}
  </div>;
}
