const categoryDefinitions = [
  {
    id: "payments",
    title: "Платежи и счета",
    terms: [
      "оплат",
      "платеж",
      "платёж",
      "счет",
      "счёт",
      "списан",
      "карта",
      "invoice",
      "billing",
      "refund",
      "возврат",
      "деньги",
      "баланс",
      "подписк",
    ],
    cause: "Вероятен сбой платежного провайдера, повторная авторизация карты или рассинхрон биллинга.",
    recommendation: "Сверить события провайдера, очередь billing-webhook и статусы счетов за период всплеска.",
  },
  {
    id: "auth",
    title: "Доступ и авторизация",
    terms: ["логин", "войти", "вход", "пароль", "2fa", "код", "авториза", "доступ", "login", "password", "token", "otp"],
    cause: "Похоже на задержку доставки кода, истекший токен или конфликт правил доступа.",
    recommendation: "Проверить OTP-провайдера, лимиты попыток входа и последние изменения auth-сервиса.",
  },
  {
    id: "orders",
    title: "Заказы и доставка",
    terms: ["заказ", "достав", "курьер", "трек", "отгруз", "shipment", "склад", "warehouse", "не приш", "статус заказа"],
    cause: "Возможен застрявший статус в интеграции склада или задержка обновления трекинга.",
    recommendation: "Проверить обмен со складом, статусы перевозчика и повторную синхронизацию заказов.",
  },
  {
    id: "product_bug",
    title: "Ошибки продукта",
    terms: ["ошиб", "баг", "не работает", "краш", "упал", "завис", "500", "404", "error", "не открывается", "сломал", "crash"],
    cause: "Вероятна регрессия в продукте, ошибка релиза или нестабильный backend endpoint.",
    recommendation: "Сверить время обращений с релизами, логами ошибок и статусом ключевых endpoints.",
  },
  {
    id: "integrations",
    title: "Интеграции и API",
    terms: ["api", "webhook", "интеграц", "crm", "amo", "bitrix", "zendesk", "telegram", "бот", "callback", "ключ", "endpoint", "helpdesk"],
    cause: "Похоже на ошибку внешней интеграции, неверный ключ или недоставленный webhook.",
    recommendation: "Проверить подписи webhook, токены, очередь повторов и доступность внешней системы.",
  },
  {
    id: "performance",
    title: "Скорость и стабильность",
    terms: ["медлен", "долго", "таймаут", "timeout", "тормоз", "latency", "задерж", "висит", "не груз", "loading"],
    cause: "Вероятны деградация производительности, перегруз очереди или сетевые таймауты.",
    recommendation: "Посмотреть p95 latency, нагрузку очередей, ошибки retry и ресурсы сервиса.",
  },
  {
    id: "notifications",
    title: "Уведомления",
    terms: ["уведом", "письмо", "email", "смс", "sms", "push", "пуш", "рассыл", "сообщение не пришло"],
    cause: "Возможна проблема канала доставки, шаблона уведомления или подавления дублей.",
    recommendation: "Проверить очередь уведомлений, provider status и правила suppression.",
  },
];

const stopwords = new Set([
  "и",
  "в",
  "во",
  "на",
  "не",
  "но",
  "что",
  "как",
  "это",
  "для",
  "или",
  "по",
  "из",
  "за",
  "от",
  "до",
  "мне",
  "нам",
  "клиент",
  "пользователь",
  "после",
  "снова",
  "опять",
  "the",
  "and",
  "for",
  "with",
]);

const severityTerms = {
  critical: ["упал", "недоступ", "всем", "массов", "production", "prod", "утеч", "security"],
  high: ["срочно", "критич", "не работает", "ошибка", "сломал", "деньги", "500", "timeout", "невозмож"],
  normal: ["не приш", "задерж", "не могу", "проблем", "долго", "медленно"],
};

const signalTerms = [
  "telegram",
  "email",
  "sms",
  "webhook",
  "api",
  "crm",
  "bitrix",
  "amo",
  "zendesk",
  "2fa",
  "otp",
  "invoice",
  "billing",
  "payment",
  "500",
  "404",
  "timeout",
  "доставка",
  "заказ",
  "уведом",
  "логин",
  "пароль",
  "код",
];

const severityWeight = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

function semanticText(value) {
  return String(value || "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value, limit = 220) {
  const text = String(value || "").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function csvRows(value, delimiter) {
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === '"') {
      if (quoted && value[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted || !cell) quoted = !quoted;
      else throw new Error("Кавычка внутри CSV-поля: заключите поле в кавычки.");
    } else if (c === delimiter && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && value[i + 1] === "\n") i++;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("В CSV не закрыты кавычки.");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseTickets(raw) {
  const value = String(raw || "").replace(/^\uFEFF/, "").trim();
  if (!value) return [];
  if (value.length > 2000000) throw new Error("Максимальный размер данных - 2 МБ.");
  if (/^[\[{]/.test(value)) {
    let parsed; try { parsed = JSON.parse(value); } catch { throw new Error("JSON содержит ошибку. Исправьте формат файла."); }
    if (Array.isArray(parsed)) return parsed;
    for (const key of ["tickets", "items", "rows", "data"]) if (Array.isArray(parsed?.[key])) return parsed[key];
    if (parsed && typeof parsed === "object") return [parsed];
    throw new Error("Ожидается массив обращений или объект с полем tickets.");
  }
  const header = value.split(/\r?\n/)[0];
  const delimiter = header.includes(";") ? ";" : ",";
  const possibleHeaders = header.split(delimiter).map(h => h.trim().replace(/^"|"$/g, "").toLowerCase());
  const isCSV = possibleHeaders.some(h => ["text","message","body","description","subject","текст"].includes(h));
  const rows = isCSV ? csvRows(value, delimiter) : [[header]];
  const aliases = {"текст":"text", "канал":"source", "клиент":"customer", "приоритет":"priority", "номер":"id"};
  const headers = rows[0].map(h => aliases[semanticText(h)] || semanticText(h));
  if (headers.some(h => ["text", "message", "body", "description", "subject"].includes(h))) {
    if (new Set(headers).size !== headers.length || headers.some(h => !h || ["__proto__", "constructor", "prototype"].includes(h))) throw new Error("Заголовки CSV должны быть непустыми и уникальными.");
    return rows.slice(1).map((cells,i) => {
      if (cells.length !== headers.length) throw new Error(`CSV: строка ${i + 2} содержит неверное число полей.`);
      return Object.fromEntries(headers.map((h,j) => [h,cells[j]]));
    });
  }
  return value.split(/\r?\n/).filter(line => line.trim()).map((line,i) => {
    const parts = line.split("|").map(v => v.trim());
    if (parts.length >= 3) {
      const priority = parts.length >= 4 ? parts.pop() : "";
      return {id: `TXT-${i+1}`, source: parts[0], customer:parts[1], text:parts.slice(2).join(" | "), priority};
    }
    return {id:`TXT-${i+1}`, source:"manual", text:line.trim()};
  });
}

function classify(text) {
  const semantic = semanticText(text);
  const scored = categoryDefinitions
    .map((definition) => ({
      definition,
      score: definition.terms.reduce((sum, term) => sum + (semantic.includes(semanticText(term)) ? 1 : 0), 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    return { id: "other", title: "Прочие обращения", score: 0 };
  }
  const best = scored[0];
  return { id: best.definition.id, title: best.definition.title, score: best.score };
}

function severity(text, explicit) {
  const explicitText = semanticText(explicit);
  if (["critical", "crit", "p0", "критично"].includes(explicitText)) return "critical";
  if (["high", "p1", "urgent", "срочно", "высокий"].includes(explicitText)) return "high";
  if (["normal", "medium", "обычный"].includes(explicitText)) return "normal";
  if (["low", "низкий"].includes(explicitText)) return "low";

  const semantic = semanticText(text);
  if (severityTerms.critical.some((term) => semantic.includes(term))) return "critical";
  if (severityTerms.high.some((term) => semantic.includes(term))) return "high";
  if (severityTerms.normal.some((term) => semantic.includes(term))) return "normal";
  return "low";
}

function topTerms(text, limit = 6) {
  const words = semanticText(text).match(/[a-zа-я0-9]{3,}/g) || [];
  const counts = new Map();
  for (const word of words) {
    if (stopwords.has(word) || /^\d+$/.test(word)) continue;
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([word]) => word);
}

function fingerprint(text, categoryId) {
  const semantic = semanticText(text);
  const signals = signalTerms.filter((term) => semantic.includes(semanticText(term)));
  const codes = semantic.match(/\b(?:[a-z]{2,6}-)?\d{3,5}\b/g) || [];
  if (signals.length || codes.length) {
    return [categoryId, ...new Set([...signals, ...codes].sort())].slice(0, 6).join("|");
  }
  return [categoryId, ...topTerms(text, 4)].join("|");
}

function tokenSimilarity(first, second) {
  const a = new Set(topTerms(first, 12));
  const b = new Set(topTerms(second, 12));
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const term of a) {
    if (b.has(term)) intersection += 1;
  }
  return intersection / Math.max(a.size, b.size);
}

function categoryById(categoryId) {
  return (
    categoryDefinitions.find((definition) => definition.id === categoryId) || {
      id: "other",
      title: "Прочие обращения",
      cause: "Пока недостаточно признаков для уверенной причины.",
      recommendation: "Разобрать вручную и добавить правило классификации после подтверждения.",
    }
  );
}

function maxSeverity(items) {
  return items.reduce((max, item) => {
    const current = typeof item === "string" ? item : item.severity || "low";
    return severityWeight[current] > severityWeight[max] ? current : max;
  }, "low");
}

function countBy(items, getter) {
  return items.reduce((acc, item) => {
    const key = getter(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, Object.create(null));
}

function normalizeTicket(item, index) {
  const source = compact(item.source || item.channel || item.integration || "manual", 40);
  const customer = compact(item.customer || item.client || item.account || item.company || "Клиент", 80);
  const subject = compact(item.subject || item.title || "", 140);
  const text = String(item.text || item.message || item.body || item.description || subject).trim();
  const fullText = [subject, text].filter(Boolean).join(". ");
  const category = classify(fullText);
  const ticketSeverity = severity(fullText, item.priority || item.severity);

  return {
    id: `SUP-${String(index + 1).padStart(4, "0")}`,
    original_id: compact(item.id || "", 80),
    source,
    customer,
    subject: subject || compact(fullText, 90),
    text: text || subject,
    created_at: compact(item.created_at || item.ts || item.date || "", 70),
    priority: compact(item.priority || item.severity || ticketSeverity, 30),
    category,
    severity: ticketSeverity,
    fingerprint: fingerprint(fullText, category.id),
    terms: topTerms(fullText, 8),
  };
}

function automationHint(categoryId, sources) {
  const source = Object.entries(sources).sort((a, b) => b[1] - a[1])[0]?.[0] || "канал";
  const hints = {
    payments: "Billing rule: high priority, проверка invoice и автоответ с номером счета.",
    auth: "Telegram/Email rule: запросить email аккаунта и приложить runbook по 2FA.",
    orders: "Helpdesk rule: подтянуть заказ, трек и последнее событие склада.",
    product_bug: "Webhook rule: создать incident draft и приложить последние ошибки релиза.",
    integrations: "API rule: проверить токен, подпись webhook и очередь retries.",
    performance: "Monitor rule: приложить latency snapshot и статус очередей.",
    notifications: "Provider rule: проверить delivery log и suppression для контакта.",
  };
  return hints[categoryId] || `Маршрутизировать новые обращения из ${source} в очередь анализа.`;
}

function clusterTickets(tickets) {
  const grouped = tickets.reduce((acc, ticket) => {
    const categoryId = ticket.category.id;
    acc[categoryId] = acc[categoryId] || [];
    acc[categoryId].push(ticket);
    return acc;
  }, {});
  const total = Math.max(1, tickets.length);

  return Object.entries(grouped)
    .map(([categoryId, items]) => {
      const definition = categoryById(categoryId);
      const fingerprints = countBy(items, (item) => item.fingerprint);
      const duplicateCount = Object.values(fingerprints).filter((count) => count > 1).reduce((sum, count) => sum + count, 0);
      const sources = countBy(items, (item) => item.source);
      return {
        id: categoryId,
        title: definition.title,
        count: items.length,
        share: Number((items.length / total).toFixed(3)),
        severity: maxSeverity(items),
        severity_counts: countBy(items, (item) => item.severity),
        sources,
        top_terms: topTerms(items.map((item) => item.text).join(" "), 8),
        duplicate_count: duplicateCount,
        cause: definition.cause,
        recommendation: definition.recommendation,
        automation: automationHint(categoryId, sources),
        tickets: items,
      };
    })
    .sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity] || b.count - a.count || a.title.localeCompare(b.title));
}

function repeatedIncidents(clusters) {
  const incidents = [];
  for (const cluster of clusters) {
    const buckets = [];
    for (const ticket of cluster.tickets) {
      let bucket = buckets.find((item) => item.fingerprint === ticket.fingerprint);
      if (!bucket) {
        bucket = buckets.find((item) => tokenSimilarity(item.text, ticket.text) >= 0.36);
      }
      if (bucket) {
        bucket.tickets.push(ticket);
        bucket.text = `${bucket.text} ${ticket.text}`;
      } else {
        buckets.push({ fingerprint: ticket.fingerprint, text: ticket.text, tickets: [ticket] });
      }
    }

    buckets
      .filter((bucket) => bucket.tickets.length >= 2)
      .forEach((bucket, index) => {
        const terms = topTerms(bucket.tickets.map((ticket) => ticket.text).join(" "), 4);
        const signal = terms.join(", ") || cluster.title;
        incidents.push({
          id: `${cluster.id}-${index + 1}`,
          cluster_id: cluster.id,
          title: `${cluster.title}: повтор ${signal}`,
          count: bucket.tickets.length,
          severity: maxSeverity(bucket.tickets),
          signal,
          affected_sources: [...new Set(bucket.tickets.map((ticket) => ticket.source))].sort(),
          affected_customers: [...new Set(bucket.tickets.map((ticket) => ticket.customer))].sort(),
          ticket_ids: bucket.tickets.map((ticket) => ticket.id),
          probable_cause: cluster.cause,
          next_action: cluster.recommendation,
        });
      });
  }

  return incidents.sort((a, b) => severityWeight[b.severity] - severityWeight[a.severity] || b.count - a.count);
}

function buildReport(summary, clusters, incidents) {
  const lines = ["# Support Analyst", "", `Обращений: ${summary.total_tickets}. Групп: ${summary.cluster_count}. Повторов: ${summary.incident_count}.`, "", "## Группы"];
  for (const c of clusters) lines.push(`- ${c.title}: ${c.count}. Приоритет: ${c.severity}. ${c.recommendation}`);
  lines.push("", "## Повторяющиеся обращения");
  if (!incidents.length) lines.push("Повторы не найдены.");
  for (const i of incidents) lines.push(`- ${i.title}: ${i.count}. Обращения: ${i.ticket_ids.join(", ")}. ${i.next_action}`);
  return lines.join("\n");
}

export function analyzeSupportTickets({raw = "", tickets = []} = {}) {
  const collected = [...tickets, ...parseTickets(raw)];
  if (collected.length > 2000) throw new Error("За один раз можно обработать до 2000 обращений.");
  for (const [i,item] of collected.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`Обращение ${i+1}: ожидается объект.`);
    if (![item.text,item.message,item.body,item.description,item.subject,item.title].some(v => typeof v === "string" && v.trim())) throw new Error(`Обращение ${i+1}: нет текста.`);
    for (const v of Object.values(item)) if (v !== null && typeof v === "object") throw new Error(`Обращение ${i+1}: поля должны содержать текст или число.`);
    if (JSON.stringify(item).length > 20000) throw new Error(`Обращение ${i+1}: слишком длинный текст.`);
  }
  const normalized = collected.map(normalizeTicket);
  const clusters = clusterTickets(normalized), incidents = repeatedIncidents(clusters);
  const summary = {total_tickets:normalized.length, cluster_count:clusters.length, incident_count:incidents.length, critical_tickets:normalized.filter(t => ["critical","high"].includes(t.severity)).length};
  return {generated_at:new Date().toISOString(),summary,tickets:normalized,clusters,incidents,report:buildReport(summary,clusters,incidents)};
}
