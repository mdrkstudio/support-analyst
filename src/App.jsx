import {useMemo, useRef, useState} from "react";
import {demoTickets} from "./data/demoTickets.js";
import {analyzeSupportTickets} from "./lib/supportAnalysis.js";
const labels = {critical:"Критичный",high:"Высокий",normal:"Обычный",low:"Низкий"};
function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text],{type}));
  const a = document.createElement("a"); a.href=url; a.download=name; a.click();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}
export default function App() {
  const [raw,setRaw]=useState(() => JSON.stringify(demoTickets,null,2));
  const [analysis,setAnalysis]=useState(() => analyzeSupportTickets({tickets:demoTickets}));
  const [error,setError]=useState(""); const [notice,setNotice]=useState("");
  const [selected,setSelected]=useState(""); const [query,setQuery]=useState(""); const [priority,setPriority]=useState("");
  const [view,setView]=useState("analysis"); const fileVersion=useRef(0);
  const cluster=analysis.clusters.find(c=>c.id===selected) || analysis.clusters[0];
  const filtered=useMemo(() => analysis.tickets.filter(t => (!priority || t.severity===priority) && `${t.text} ${t.customer} ${t.source}`.toLowerCase().includes(query.toLowerCase())),[analysis,priority,query]);
  function analyze(value=raw) { try { const next=analyzeSupportTickets({raw:value});setAnalysis(next);setSelected("");setError("");setNotice(`Обработано обращений: ${next.summary.total_tickets}`);return true; } catch(e) {setError(e.message);setNotice("");return false;} }
  async function importFile(event) {
    const version=++fileVersion.current; const file=event.target.files?.[0];event.target.value="";if(!file)return;
    if(file.size>2000000){setError("Размер файла должен быть не больше 2 МБ.");return;}
    try {const text=await file.text();if(version!==fileVersion.current)return;setRaw(text);if(analyze(text))setView("analysis");} catch {setError("Не удалось прочитать файл.");}
  }
  function demo(){fileVersion.current++;const text=JSON.stringify(demoTickets,null,2);setRaw(text);analyze(text);}
  function clear(){fileVersion.current++;setRaw("");analyze("");}
  async function copy(){try{await navigator.clipboard.writeText(analysis.report);setNotice("Отчёт скопирован");}catch{setError("Копирование недоступно. Скачайте файл отчёта.");}}
  return <main className="app-shell">
    <header className="top-header"><div><span className="eyebrow">MDRK STUDIO / SUPPORT TOOLS</span><h1>Support Analyst</h1><p>Обращения, группы проблем и следующие действия</p></div><nav className="queue-actions" aria-label="Разделы">{[["analysis","Обзор"],["queue","Импорт и очередь"],["report","Отчёт"]].map(([id,title])=><button key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{title}</button>)}</nav></header>
    <div role="alert" className={error?"error-banner":""}>{error}</div><p role="status">{notice}</p>
    <section className="stats-grid">{[["Обращения",analysis.summary.total_tickets],["Группы",analysis.summary.cluster_count],["Повторы",analysis.summary.incident_count],["Высокий приоритет",analysis.summary.critical_tickets]].map(([title,n])=><article className="glass-panel stat" key={title}><span>{title}</span><strong>{n}</strong></article>)}</section>
    {view==="analysis" && <><section className="analysis-grid"><article className="glass-panel"><div className="panel-heading"><h2>Группы проблем</h2><p>Выберите группу, чтобы увидеть обращения</p></div><div className="group-list">{analysis.clusters.map(c=><button className="group-choice" key={c.id} aria-pressed={cluster?.id===c.id} onClick={()=>setSelected(c.id)}><span>{c.title}</span><strong>{c.count}</strong></button>)}{!cluster&&<p>Загрузите обращения или откройте пример.</p>}</div></article><article className="glass-panel"><div className="panel-heading"><h2>{cluster?.title || "Нет обращений"}</h2></div>{cluster&&<><span className={`severity severity--${cluster.severity}`}>{labels[cluster.severity]}</span><h3>Следующий шаг</h3><p>{cluster.recommendation}</p><h3>Обращения</h3>{cluster.tickets.map(t=><div className="example-row" key={t.id}><div><strong>{t.customer}</strong><p>{t.text}</p><small>{t.id} / {t.source}</small></div></div>)}</>}</article></section><section className="glass-panel"><h2>Повторяющиеся обращения</h2>{analysis.incidents.length?analysis.incidents.map(i=><article className="example-row" key={i.id}><div><strong>{i.title}</strong><p>{i.count} обращения / {i.affected_customers.join(", ")}</p><small>{i.ticket_ids.join(", ")}</small></div></article>):<p>Повторы не найдены.</p>}</section></>}
    {view==="queue"&&<section className="glass-panel queue-panel"><div className="panel-heading row-heading"><div><h2>Импорт обращений</h2><p>JSON, CSV или строки: канал | клиент | текст | приоритет</p></div><div className="queue-actions"><button onClick={()=>analyze()}>Анализировать</button><label>Загрузить файл<input type="file" accept=".csv,.json,.txt" onChange={importFile}/></label><button onClick={demo}>Пример</button><button onClick={clear}>Очистить</button></div></div><label htmlFor="tickets">Текст обращений</label><textarea id="tickets" value={raw} spellCheck={false} onChange={e=>{fileVersion.current++;setRaw(e.target.value);}}/><div className="filters"><label>Поиск<input type="search" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>Приоритет<select value={priority} onChange={e=>setPriority(e.target.value)}><option value="">Все</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><span>Найдено: {filtered.length}</span></div><div className="ticket-list">{filtered.map(t=><article className="example-row" key={t.id}><div><strong>{t.customer} / {t.source}</strong><p>{t.text}</p></div><span className={`severity severity--${t.severity}`}>{labels[t.severity]}</span></article>)}</div></section>}
    {view==="report"&&<section className="glass-panel report-panel"><div className="panel-heading row-heading"><h2>Отчёт для команды</h2><div className="queue-actions"><button onClick={copy}>Копировать</button><button onClick={()=>download(analysis.report,"support-report.md","text/markdown;charset=utf-8")}>Скачать Markdown</button><button onClick={()=>download(JSON.stringify(analysis,null,2),"support-analysis.json","application/json")}>Скачать JSON</button></div></div><pre>{analysis.report}</pre></section>}
    <footer className="app-footer"><span>Классификация по правилам / данные остаются в браузере</span><a href="https://mdrkstudio.ru">MDRK Studio</a></footer>
  </main>;
}
