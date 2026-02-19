require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const compression = require("compression");

const app = express();
app.use(compression());
const PORT = Number(process.env.PORT || 3001);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 120000); // 2 minutos
const MAX_PAGES = Number(process.env.MAX_PAGES || 30);
const CLICKUP_TIMEOUT_MS = Number(process.env.CLICKUP_TIMEOUT_MS || 45000);
const TEAM_TASKS_TTL_MS = Number(process.env.TEAM_TASKS_TTL_MS || 300000); // 5 minutos para tarefas brutas
const NAVIGATION_TTL_MS = Number(process.env.NAVIGATION_TTL_MS || 600000); // 10 minutos para navegação
const TEAM_LIST_TTL_MS = Number(process.env.TEAM_LIST_TTL_MS || 600000);
const PAGE_FETCH_CONCURRENCY = Math.max(1, Number(process.env.PAGE_FETCH_CONCURRENCY || 6));
const DEFAULT_PERIOD_DAYS = Math.max(1, Number(process.env.DEFAULT_PERIOD_DAYS || 365));
const DEFAULT_TABLE_PAGE_SIZE = Math.max(10, Number(process.env.DEFAULT_TABLE_PAGE_SIZE || 50));
const MAX_TABLE_PAGE_SIZE = Math.max(
  DEFAULT_TABLE_PAGE_SIZE,
  Number(process.env.MAX_TABLE_PAGE_SIZE || 200)
);

const CLICKUP_API_KEY = process.env.CLICKUP_API_KEY;
const CLICKUP_API_BASE = "https://api.clickup.com/api/v2";

const normalizeToken = (rawToken) =>
  String(rawToken || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

const resolveRequestToken = (req) =>
  normalizeToken(req?.headers?.authorization || req?.query?.token || "");

const getClickUpClient = (requestToken) => {
  const resolvedToken = normalizeToken(requestToken) || normalizeToken(CLICKUP_API_KEY);

  if (!resolvedToken) {
    const error = new Error("Missing ClickUp token");
    error.statusCode = 401;
    throw error;
  }

  return axios.create({
    baseURL: CLICKUP_API_BASE,
    timeout: CLICKUP_TIMEOUT_MS,
    headers: {
      Authorization: resolvedToken,
      "Content-Type": "application/json",
    },
  });
};

app.use(cors());
app.use(express.json());

const dashboardCache = new Map();
const inflightDashboard = new Map();
const teamTasksCache = new Map();
const inflightTeamTasks = new Map();
const navigationCache = new Map();
const inflightNavigation = new Map();
const teamsCache = new Map();
const inflightTeams = new Map();

const DAY_MS = 24 * 60 * 60 * 1000;

const toMs = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const normalizeText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const formatPercent = (value, decimals = 1) =>
  Number.isFinite(value) ? Number(value.toFixed(decimals)) : 0;

const getStatusLabel = (task) => task?.status?.status || "Sem status";

const getAssigneeNames = (task) => {
  const names = (task?.assignees || [])
    .map((assignee) => assignee?.username || assignee?.email)
    .filter(Boolean);
  return names.length > 0 ? names : ["Sem responsavel"];
};

const isClosedTask = (task) => task?.status?.type === "closed";

const isOverdueTask = (task, nowMs) => {
  const dueDate = toMs(task?.due_date);
  if (!dueDate || isClosedTask(task)) return false;
  return dueDate < nowMs;
};

const getPriorityBucket = (task) => {
  const priorityName = normalizeText(task?.priority?.priority || "");
  if (priorityName.includes("urgent") || priorityName === "p0") return "P0";
  if (priorityName.includes("high") || priorityName === "p1") return "P1";
  return "P2";
};

const classifyFlowStatus = (task) => {
  if (isClosedTask(task)) return "Concluida";
  const name = normalizeText(getStatusLabel(task));

  if (
    name.includes("aguard") ||
    name.includes("waiting") ||
    name.includes("blocked") ||
    name.includes("on hold")
  ) {
    return "Aguardando";
  }

  if (
    name.includes("progres") ||
    name.includes("andamento") ||
    name.includes("doing") ||
    name.includes("execu")
  ) {
    return "Em andamento";
  }

  if (
    name.includes("backlog") ||
    name.includes("to do") ||
    name.includes("todo") ||
    name.includes("nao iniciado") ||
    name.includes("pendente") ||
    name.includes("new")
  ) {
    return "Backlog";
  }

  return "Em aberto";
};

const getStatusAgeMs = (task, nowMs) => {
  const base =
    toMs(task?.date_status_changed) ||
    toMs(task?.date_updated) ||
    toMs(task?.start_date) ||
    toMs(task?.date_created);

  if (!base) return null;
  const age = nowMs - base;
  return age > 0 ? age : null;
};

const findCustomField = (task, nameMatchers) => {
  const fields = task?.custom_fields || [];
  return fields.find((field) => {
    const fieldName = normalizeText(field?.name || "");
    return nameMatchers.some((matcher) => fieldName.includes(matcher));
  });
};

const customFieldValueToString = (field) => {
  if (!field || field.value === null || field.value === undefined) return null;
  if (typeof field.value === "string") return field.value;
  if (typeof field.value === "number") return String(field.value);

  if (field.type === "drop_down" && field.type_config?.options?.length) {
    const matched = field.type_config.options.find(
      (option) => String(option.id) === String(field.value)
    );
    if (matched?.name) return matched.name;
  }

  if (typeof field.value === "object") {
    if (field.value.name) return String(field.value.name);
    if (field.value.label) return String(field.value.label);
  }

  return null;
};

const parseFirstResponseMs = (task) => {
  const field = findCustomField(task, [
    "primeira resposta",
    "first response",
    "tempo de resposta",
    "response time",
  ]);
  if (!field) return null;

  const raw = field.value;
  if (raw === null || raw === undefined || raw === "") return null;

  if (field.type === "date") {
    const created = toMs(task?.date_created);
    const responseDate = toMs(raw);
    if (created && responseDate && responseDate > created) {
      return responseDate - created;
    }
    return null;
  }

  if (typeof raw === "number") {
    if (raw > DAY_MS * 10) return raw;
    if (raw > 100000) return raw;
    return raw * 60 * 1000;
  }

  const normalized = normalizeText(raw);
  const hoursMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*h/);
  const minutesMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*m/);
  const secondsMatch = normalized.match(/(\d+(?:[.,]\d+)?)\s*s/);

  let total = 0;
  if (hoursMatch) total += Number(hoursMatch[1].replace(",", ".")) * 3600000;
  if (minutesMatch) total += Number(minutesMatch[1].replace(",", ".")) * 60000;
  if (secondsMatch) total += Number(secondsMatch[1].replace(",", ".")) * 1000;
  if (total > 0) return total;

  const numeric = Number(String(raw).replace(",", "."));
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric > DAY_MS * 10) return numeric;
    if (numeric > 100000) return numeric;
    return numeric * 60 * 1000;
  }

  return null;
};

const getClientGroup = (task) => {
  const field = findCustomField(task, ["cliente", "customer", "client"]);
  const fromField = customFieldValueToString(field);
  if (fromField) return fromField;

  const firstTag = task?.tags?.[0]?.name;
  if (firstTag) return firstTag;

  return "Geral";
};

const getCategory = (task) => {
  const field = findCustomField(task, ["categoria", "category", "tipo", "type"]);
  const fromField = customFieldValueToString(field);
  if (fromField) return fromField;

  const firstTag = task?.tags?.[0]?.name;
  if (firstTag) return firstTag;

  return "Sem categoria";
};

const averageMs = (values) => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const toHours = (ms) => formatPercent(ms / 3600000, 2);
const toDays = (ms) => formatPercent(ms / DAY_MS, 2);

const startOfTodayMs = (nowMs) => {
  const now = new Date(nowMs);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

const startOfWeekMs = (nowMs) => {
  const now = new Date(nowMs);
  const dayOfWeek = now.getDay();
  const distanceToMonday = (dayOfWeek + 6) % 7;
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - distanceToMonday
  ).getTime();
};

const createDailyBuckets = (nowMs, totalDays = 7) => {
  const buckets = [];
  for (let offset = totalDays - 1; offset >= 0; offset -= 1) {
    const current = new Date(nowMs - offset * DAY_MS);
    const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(current.getDate()).padStart(2, "0")}`;
    buckets.push({
      key,
      date: key,
      label: current.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      }),
      value: 0,
    });
  }
  return buckets;
};

const incrementMap = (map, key, amount = 1) => {
  map.set(key, (map.get(key) || 0) + amount);
};

const normalizeScopeType = (rawScopeType) => {
  const resolved = String(rawScopeType || "team").toLowerCase();
  return ["team", "space", "folder", "list"].includes(resolved) ? resolved : "team";
};

const resolveScope = (rawScopeType, rawScopeId) => {
  const type = normalizeScopeType(rawScopeType);
  const id = String(rawScopeId || "").trim() || null;

  if (type === "team") {
    return { type: "team", id: null };
  }

  if (!id) {
    return { type: "team", id: null };
  }

  return { type, id };
};

const getScopeCacheFragment = (scope) => `${scope.type}:${scope.id || "all"}`;

const taskMatchesScope = (task, scope) => {
  if (scope.type === "team") return true;

  const taskSpaceId = task?.space?.id ? String(task.space.id) : null;
  const taskFolderId = task?.folder?.id ? String(task.folder.id) : null;
  const taskListId = task?.list?.id ? String(task.list.id) : null;

  if (scope.type === "space") return taskSpaceId === scope.id;
  if (scope.type === "folder") return taskFolderId === scope.id;
  if (scope.type === "list") return taskListId === scope.id;
  return true;
};

const filterTasksByScope = (tasks, scope) => {
  if (!scope || scope.type === "team") return tasks;
  return tasks.filter((task) => taskMatchesScope(task, scope));
};

const buildScopeLabel = (scope) => {
  if (scope.type === "team") return "Todas as tarefas";
  if (scope.type === "space") return `Space ${scope.id}`;
  if (scope.type === "folder") return `Pasta ${scope.id}`;
  if (scope.type === "list") return `Lista ${scope.id}`;
  return "Escopo";
};

const parseInteger = (rawValue, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const readQueryText = (rawValue) => {
  if (Array.isArray(rawValue)) {
    return String(rawValue[0] || "").trim();
  }
  return String(rawValue || "").trim();
};

const resolveDashboardFilters = (query = {}) => ({
  periodDays: parseInteger(query.periodDays, DEFAULT_PERIOD_DAYS, 1, 3650),
  status: readQueryText(query.status),
  category: readQueryText(query.category),
  assignee: readQueryText(query.assignee),
  priority: readQueryText(query.priority),
  page: parseInteger(query.page, 1, 1, 100000),
  pageSize: parseInteger(query.pageSize, DEFAULT_TABLE_PAGE_SIZE, 10, MAX_TABLE_PAGE_SIZE),
});

const getFilterCacheFragment = (filters) =>
  [
    `period:${filters.periodDays}`,
    `status:${normalizeText(filters.status) || "all"}`,
    `category:${normalizeText(filters.category) || "all"}`,
    `assignee:${normalizeText(filters.assignee) || "all"}`,
    `priority:${normalizeText(filters.priority) || "all"}`,
    `page:${filters.page}`,
    `pageSize:${filters.pageSize}`,
  ].join("|");

const getTaskReferenceMs = (task) =>
  toMs(task?.date_status_changed) ||
  toMs(task?.date_updated) ||
  toMs(task?.date_closed) ||
  toMs(task?.date_created);

const equalsNormalizedText = (leftValue, rightValue) =>
  normalizeText(leftValue) === normalizeText(rightValue);

const taskMatchesDashboardFilters = (task, filters, nowMs) => {
  if (!task) return false;

  if (filters.periodDays > 0) {
    const thresholdMs = nowMs - filters.periodDays * DAY_MS;
    const referenceMs = getTaskReferenceMs(task);
    if (referenceMs && referenceMs < thresholdMs) return false;
  }

  if (filters.status) {
    if (!equalsNormalizedText(getStatusLabel(task), filters.status)) return false;
  }

  if (filters.category) {
    if (!equalsNormalizedText(getCategory(task), filters.category)) return false;
  }

  if (filters.assignee) {
    const hasAssignee = getAssigneeNames(task).some((name) =>
      equalsNormalizedText(name, filters.assignee)
    );
    if (!hasAssignee) return false;
  }

  if (filters.priority) {
    if (!equalsNormalizedText(getPriorityBucket(task), filters.priority)) return false;
  }

  return true;
};

const filterTasksByDashboardFilters = (tasks, filters, nowMs) => {
  if (!Array.isArray(tasks) || tasks.length === 0) return [];
  return tasks.filter((task) => taskMatchesDashboardFilters(task, filters, nowMs));
};

const toIsoDateString = (valueMs) => {
  if (!valueMs) return null;
  const parsed = new Date(Number(valueMs));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const buildDimensionEntries = (map) =>
  Array.from(map.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

const buildDimensionBreakdown = (tasks) => {
  const statusMap = new Map();
  const categoryMap = new Map();
  const priorityMap = new Map();
  const assigneeMap = new Map();

  (tasks || []).forEach((task) => {
    incrementMap(statusMap, getStatusLabel(task));
    incrementMap(categoryMap, getCategory(task));
    incrementMap(priorityMap, getPriorityBucket(task));
    getAssigneeNames(task).forEach((assignee) => incrementMap(assigneeMap, assignee));
  });

  return {
    statuses: buildDimensionEntries(statusMap),
    categories: buildDimensionEntries(categoryMap),
    priorities: buildDimensionEntries(priorityMap),
    assignees: buildDimensionEntries(assigneeMap),
  };
};

const buildTaskDetailRow = (task, nowMs) => {
  const createdAtMs = toMs(task?.date_created);
  const updatedAtMs = toMs(task?.date_updated);
  const statusChangedAtMs = toMs(task?.date_status_changed);
  const startAtMs = toMs(task?.start_date);
  const dueAtMs = toMs(task?.due_date);
  const closedAtMs = toMs(task?.date_closed);
  const statusAgeMs = getStatusAgeMs(task, nowMs);
  const closed = isClosedTask(task);
  const overdue = isOverdueTask(task, nowMs);
  const referenceMs = getTaskReferenceMs(task);

  let leadTimeHours = null;
  if (createdAtMs && closedAtMs && closedAtMs >= createdAtMs) {
    leadTimeHours = toHours(closedAtMs - createdAtMs);
  }

  let cycleTimeHours = null;
  if (startAtMs && closedAtMs && closedAtMs >= startAtMs) {
    cycleTimeHours = toHours(closedAtMs - startAtMs);
  }

  return {
    id: String(task?.id || ""),
    name: task?.name || "Sem titulo",
    url: task?.url || null,
    status: getStatusLabel(task),
    statusType: task?.status?.type || "unknown",
    category: getCategory(task),
    priority: getPriorityBucket(task),
    assignees: getAssigneeNames(task),
    assignee: getAssigneeNames(task).join(", "),
    spaceId: task?.space?.id ? String(task.space.id) : null,
    space: task?.space?.name || "Sem Space",
    folderId: task?.folder?.id ? String(task.folder.id) : null,
    folder: task?.folder?.name || "Sem pasta",
    listId: task?.list?.id ? String(task.list.id) : null,
    list: task?.list?.name || "Sem lista",
    group: getClientGroup(task),
    isClosed: closed,
    isOverdue: overdue,
    referenceAt: toIsoDateString(referenceMs),
    createdAt: toIsoDateString(createdAtMs),
    updatedAt: toIsoDateString(updatedAtMs),
    statusChangedAt: toIsoDateString(statusChangedAtMs),
    startAt: toIsoDateString(startAtMs),
    dueAt: toIsoDateString(dueAtMs),
    closedAt: toIsoDateString(closedAtMs),
    statusAgeHours: statusAgeMs ? toHours(statusAgeMs) : 0,
    leadTimeHours,
    cycleTimeHours,
  };
};

const paginateRows = (rows, page, pageSize) => {
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;
  const data = rows.slice(start, start + pageSize);

  return {
    rows: data,
    page: safePage,
    pageSize,
    totalRows,
    totalPages,
  };
};

const buildIndicatorCatalog = () => [
  {
    id: "wip_total",
    name: "WIP Total",
    definition:
      "Conta tarefas abertas para monitorar carga atual e apoiar decisao de priorizacao.",
    source: {
      collections: ["ClickUp Tasks"],
      fields: ["status", "date_closed", "assignees", "space", "folder", "list"],
      relationships: ["team -> tasks"],
      includeRules: ["considera tarefas no escopo ativo e filtros aplicados"],
    },
    calculation: {
      formula: "COUNT(task.id WHERE status_type != closed)",
      aggregation: "COUNT",
      unit: "tasks",
      nullHandling: "registros sem status entram como 'Sem status'",
    },
    visualization: {
      historical: "throughput.daily (apoio de tendencia)",
      distribution: ["wipByStatus", "ticketsByCategory"],
      detailTable: "details.rows",
    },
  },
  {
    id: "lead_time",
    name: "Lead Time Medio",
    definition:
      "Tempo medio entre criacao e conclusao. Apoia eficiencia de entrega ponta a ponta.",
    source: {
      collections: ["ClickUp Tasks"],
      fields: ["date_created", "date_closed", "status", "category"],
      relationships: ["task -> status/category"],
      includeRules: ["apenas tarefas concluidas com datas validas"],
    },
    calculation: {
      formula: "AVG(date_closed - date_created)",
      aggregation: "AVG",
      unit: "hours/days",
      nullHandling: "tarefas sem data valida sao ignoradas",
    },
    visualization: {
      historical: "throughput.daily + comparacao de periodos",
      distribution: ["agingByStatus"],
      detailTable: "details.rows",
    },
  },
  {
    id: "cycle_time",
    name: "Cycle Time Medio",
    definition:
      "Tempo medio entre inicio e conclusao. Apoia monitoramento operacional da execucao.",
    source: {
      collections: ["ClickUp Tasks"],
      fields: ["start_date", "date_closed", "status", "assignees"],
      relationships: ["task -> assignee/status"],
      includeRules: ["apenas tarefas com start_date e date_closed validos"],
    },
    calculation: {
      formula: "AVG(date_closed - start_date)",
      aggregation: "AVG",
      unit: "hours/days",
      nullHandling: "tarefas sem start_date nao entram no calculo",
    },
    visualization: {
      historical: "throughput.daily + agingByStatus",
      distribution: ["capacityByAssignee"],
      detailTable: "details.rows",
    },
  },
  {
    id: "sla_compliance",
    name: "SLA Compliance",
    definition:
      "Percentual de tarefas entregues no prazo para avaliar aderencia operacional.",
    source: {
      collections: ["ClickUp Tasks"],
      fields: ["due_date", "date_closed", "status", "category"],
      relationships: ["task -> group/category"],
      includeRules: ["somente tarefas com due_date"],
    },
    calculation: {
      formula: "(slaMet / (slaMet + slaBreached)) * 100",
      aggregation: "RATIO",
      unit: "%",
      nullHandling: "quando nao houver due_date, compliance retorna 0",
    },
    visualization: {
      historical: "throughput.daily + evolucao por periodo",
      distribution: ["slaByGroup", "ticketsByCategory"],
      detailTable: "details.rows",
    },
  },
  {
    id: "throughput_week",
    name: "Throughput",
    definition:
      "Volume de tarefas concluidas por dia para leitura de tendencia e capacidade.",
    source: {
      collections: ["ClickUp Tasks"],
      fields: ["date_closed", "status", "assignees"],
      relationships: ["task -> day bucket"],
      includeRules: ["apenas tarefas concluidas com date_closed"],
    },
    calculation: {
      formula: "COUNT(tasks closed per day)",
      aggregation: "COUNT",
      unit: "tasks/day",
      nullHandling: "dias sem entrega recebem valor zero",
    },
    visualization: {
      historical: "throughput.daily",
      distribution: ["priorityQueue"],
      detailTable: "details.rows",
    },
  },
];

const getTaskCacheKey = (token, teamId) => `${token || "default"}_${teamId}`;

const buildDashboard = ({
  team,
  tasks,
  nowMs,
  scope,
  sourceTaskCount,
  scopedTaskCount,
  dimensionBaseTasks,
  filters,
}) => {
  const safeFilters = filters || resolveDashboardFilters({});
  const scopeTasksForDimensions =
    Array.isArray(dimensionBaseTasks) && dimensionBaseTasks.length ? dimensionBaseTasks : tasks;
  const dimensions = buildDimensionBreakdown(scopeTasksForDimensions);
  const detailRows = (tasks || [])
    .map((task) => buildTaskDetailRow(task, nowMs))
    .sort((left, right) =>
      String(right.referenceAt || right.updatedAt || right.createdAt || "").localeCompare(
        String(left.referenceAt || left.updatedAt || left.createdAt || "")
      )
    );
  const details = paginateRows(detailRows, safeFilters.page, safeFilters.pageSize);
  const effectiveScopedTaskCount = Number.isFinite(scopedTaskCount)
    ? scopedTaskCount
    : tasks.length;

  const openTasks = tasks.filter((task) => !isClosedTask(task));
  const closedTasks = tasks.filter((task) => isClosedTask(task));

  const todayStart = startOfTodayMs(nowMs);
  const weekStart = startOfWeekMs(nowMs);

  const doneToday = closedTasks.filter((task) => {
    const closedAt = toMs(task.date_closed);
    return closedAt && closedAt >= todayStart;
  }).length;

  const doneWeek = closedTasks.filter((task) => {
    const closedAt = toMs(task.date_closed);
    return closedAt && closedAt >= weekStart;
  }).length;

  const wipByStatusMap = new Map();
  openTasks.forEach((task) => incrementMap(wipByStatusMap, getStatusLabel(task)));

  const flowMap = new Map();
  openTasks.forEach((task) => incrementMap(flowMap, classifyFlowStatus(task)));

  const backlogCount = flowMap.get("Backlog") || 0;
  const inProgressCount = flowMap.get("Em andamento") || 0;
  const waitingCount = flowMap.get("Aguardando") || 0;

  const overdueTasks = openTasks.filter((task) => isOverdueTask(task, nowMs));
  const overdueByAssigneeMap = new Map();
  overdueTasks.forEach((task) => {
    getAssigneeNames(task).forEach((name) => incrementMap(overdueByAssigneeMap, name));
  });

  const agingByStatusMeta = new Map();
  openTasks.forEach((task) => {
    const status = getStatusLabel(task);
    const ageMs = getStatusAgeMs(task, nowMs);
    if (!ageMs) return;
    if (!agingByStatusMeta.has(status)) {
      agingByStatusMeta.set(status, { totalMs: 0, tasks: 0 });
    }
    const current = agingByStatusMeta.get(status);
    current.totalMs += ageMs;
    current.tasks += 1;
  });

  const leadTimeSamples = [];
  const cycleTimeSamples = [];
  closedTasks.forEach((task) => {
    const createdAt = toMs(task.date_created);
    const startAt = toMs(task.start_date);
    const closedAt = toMs(task.date_closed);

    if (createdAt && closedAt && closedAt >= createdAt) {
      leadTimeSamples.push(closedAt - createdAt);
    }

    if (startAt && closedAt && closedAt >= startAt) {
      cycleTimeSamples.push(closedAt - startAt);
    }
  });

  const oldestStalled = openTasks
    .map((task) => {
      const statusAge = getStatusAgeMs(task, nowMs) || 0;
      return {
        id: task.id,
        name: task.name,
        status: getStatusLabel(task),
        assignee: getAssigneeNames(task).join(", "),
        daysStalled: toDays(statusAge),
        dueDate: toMs(task.due_date) ? new Date(Number(task.due_date)).toISOString() : null,
        priority: getPriorityBucket(task),
        url: task.url || null,
      };
    })
    .sort((a, b) => b.daysStalled - a.daysStalled)
    .slice(0, 10);

  const capacityMap = new Map();
  openTasks.forEach((task) => {
    const overdue = isOverdueTask(task, nowMs);
    const isHighPriority = ["P0", "P1"].includes(getPriorityBucket(task));

    getAssigneeNames(task).forEach((assignee) => {
      if (!capacityMap.has(assignee)) {
        capacityMap.set(assignee, {
          assignee,
          wip: 0,
          overdue: 0,
          highPriority: 0,
          loadScore: 0,
        });
      }

      const current = capacityMap.get(assignee);
      current.wip += 1;
      if (overdue) current.overdue += 1;
      if (isHighPriority) current.highPriority += 1;
      current.loadScore = formatPercent(
        current.wip + current.overdue * 2 + current.highPriority * 1.5,
        1
      );
    });
  });

  const priorityMap = new Map([
    ["P0", 0],
    ["P1", 0],
    ["P2", 0],
  ]);
  openTasks.forEach((task) => incrementMap(priorityMap, getPriorityBucket(task)));

  const reopenedProxy = tasks.filter(
    (task) => !isClosedTask(task) && Boolean(toMs(task.date_closed))
  ).length;
  const reworkBase = Math.max(closedTasks.length, 1);
  const reworkRate = formatPercent((reopenedProxy / reworkBase) * 100, 2);

  const slaByGroupMap = new Map();
  const tasksWithDueDate = tasks.filter((task) => Boolean(toMs(task.due_date)));
  tasksWithDueDate.forEach((task) => {
    const group = getClientGroup(task);
    const dueAt = toMs(task.due_date);
    if (!dueAt) return;

    const closedAt = toMs(task.date_closed);
    const breached = isClosedTask(task) ? Boolean(closedAt && closedAt > dueAt) : dueAt < nowMs;

    if (!slaByGroupMap.has(group)) {
      slaByGroupMap.set(group, { group, met: 0, breached: 0, total: 0 });
    }

    const current = slaByGroupMap.get(group);
    current.total += 1;
    if (breached) current.breached += 1;
    else current.met += 1;
  });

  const slaSummary = Array.from(slaByGroupMap.values())
    .map((item) => ({
      ...item,
      complianceRate: item.total ? formatPercent((item.met / item.total) * 100, 2) : 0,
    }))
    .sort((a, b) => b.total - a.total);

  const slaMet = slaSummary.reduce((sum, item) => sum + item.met, 0);
  const slaBreached = slaSummary.reduce((sum, item) => sum + item.breached, 0);

  const categoriesMap = new Map();
  tasks.forEach((task) => incrementMap(categoriesMap, getCategory(task)));

  const firstResponseSamples = tasks
    .map((task) => parseFirstResponseMs(task))
    .filter((value) => Number.isFinite(value) && value > 0);

  const throughputDaily = createDailyBuckets(nowMs, 7);
  const throughputByDate = new Map(throughputDaily.map((item) => [item.key, item]));
  closedTasks.forEach((task) => {
    const closedAt = toMs(task.date_closed);
    if (!closedAt) return;
    const dateKey = new Date(closedAt).toISOString().slice(0, 10);
    if (!throughputByDate.has(dateKey)) return;
    throughputByDate.get(dateKey).value += 1;
  });

  return {
    team: {
      id: String(team.id),
      name: team.name,
      color: team.color || null,
    },
    scope: {
      type: scope.type,
      id: scope.id,
      label: buildScopeLabel(scope),
    },
    generatedAt: new Date(nowMs).toISOString(),
    counters: {
      sourceTasks: sourceTaskCount,
      scopedTasks: effectiveScopedTaskCount,
      totalTasks: tasks.length,
      filteredTasks: tasks.length,
      wipTotal: openTasks.length,
      backlog: backlogCount,
      inProgress: inProgressCount,
      waiting: waitingCount,
      doneToday,
      doneWeek,
      overdueTotal: overdueTasks.length,
      slaMet,
      slaBreached,
      reworkRatePercent: reworkRate,
    },
    wipByStatus: Array.from(wipByStatusMap.entries())
      .map(([status, value]) => ({ status, value }))
      .sort((a, b) => b.value - a.value),
    flowBuckets: [
      { status: "Backlog", value: backlogCount },
      { status: "Em andamento", value: inProgressCount },
      { status: "Aguardando", value: waitingCount },
      { status: "Em aberto", value: flowMap.get("Em aberto") || 0 },
    ],
    throughput: {
      doneToday,
      doneWeek,
      daily: throughputDaily.map((item) => ({
        label: item.label,
        date: item.date,
        value: item.value,
      })),
    },
    overdue: {
      total: overdueTasks.length,
      byAssignee: Array.from(overdueByAssigneeMap.entries())
        .map(([assignee, value]) => ({ assignee, value }))
        .sort((a, b) => b.value - a.value),
    },
    agingByStatus: Array.from(agingByStatusMeta.entries())
      .map(([status, meta]) => ({
        status,
        tasks: meta.tasks,
        avgHours: toHours(meta.totalMs / meta.tasks),
      }))
      .sort((a, b) => b.avgHours - a.avgHours),
    leadTime: {
      avgHours: toHours(averageMs(leadTimeSamples)),
      avgDays: toDays(averageMs(leadTimeSamples)),
      sampleSize: leadTimeSamples.length,
    },
    cycleTime: {
      avgHours: toHours(averageMs(cycleTimeSamples)),
      avgDays: toDays(averageMs(cycleTimeSamples)),
      sampleSize: cycleTimeSamples.length,
    },
    oldestStalled,
    capacityByAssignee: Array.from(capacityMap.values()).sort(
      (a, b) => b.loadScore - a.loadScore
    ),
    priorityQueue: Array.from(priorityMap.entries()).map(([priority, value]) => ({
      priority,
      value,
    })),
    rework: {
      reopenedProxy,
      base: reworkBase,
      ratePercent: reworkRate,
      note: "Proxy baseado em tarefas abertas que ja tiveram data de fechamento.",
    },
    slaByGroup: slaSummary,
    ticketsByCategory: Array.from(categoriesMap.entries())
      .map(([category, value]) => ({ category, value }))
      .sort((a, b) => b.value - a.value),
    firstResponse: {
      available: firstResponseSamples.length > 0,
      avgHours: toHours(averageMs(firstResponseSamples)),
      sampleSize: firstResponseSamples.length,
    },
    notes: {
      agingMethod: "Aging calculado por date_status_changed/date_updated/date_created.",
      cycleMethod: "Cycle time usa start_date -> date_closed quando start_date existe.",
    },
    filters: {
      applied: {
        periodDays: safeFilters.periodDays,
        status: safeFilters.status || null,
        category: safeFilters.category || null,
        assignee: safeFilters.assignee || null,
        priority: safeFilters.priority || null,
      },
    },
    dimensions,
    details,
    indicatorCatalog: buildIndicatorCatalog(),
    validation: {
      chartTableConsistent: details.totalRows === tasks.length,
      statusAndCategoryFilterable: true,
      auditTableAvailable: details.totalRows >= 0,
      historicalAvailable: true,
    },
  };
};

const getTeams = async (client) => {
  const response = await client.get("/team");
  return response.data?.teams || [];
};

const getTeamsCacheKey = (token) => token || "default";

const getTeamsCached = async ({ token, client, forceRefresh = false }) => {
  const cacheKey = getTeamsCacheKey(token);
  const nowMs = Date.now();

  if (!forceRefresh) {
    const cached = teamsCache.get(cacheKey);
    if (cached && nowMs - cached.cachedAtMs <= TEAM_LIST_TTL_MS) {
      return cached.teams;
    }
  }

  if (inflightTeams.has(cacheKey)) {
    return inflightTeams.get(cacheKey);
  }

  const loadPromise = (async () => {
    const teams = await getTeams(client);
    teamsCache.set(cacheKey, {
      cachedAtMs: Date.now(),
      teams,
    });
    return teams;
  })();

  inflightTeams.set(cacheKey, loadPromise);

  try {
    return await loadPromise;
  } finally {
    inflightTeams.delete(cacheKey);
  }
};

const getTeamByIdOrDefault = async (
  requestedTeamId,
  token,
  client,
  forceRefresh = false
) => {
  const teams = await getTeamsCached({
    token,
    client,
    forceRefresh,
  });

  if (!teams.length) {
    throw new Error("No team returned by ClickUp API");
  }

  if (!requestedTeamId) return teams[0];

  const team = teams.find((item) => String(item.id) === String(requestedTeamId));
  return team || teams[0];
};

const fetchTeamTasksPage = async (teamId, client, page, extraParams = {}) => {
  const response = await client.get(`/team/${teamId}/task`, {
    params: {
      include_closed: true,
      subtasks: true,
      page,
      ...extraParams,
    },
  });

  const pageTasks = response.data?.tasks || [];
  const hasLastPageFlag = Object.prototype.hasOwnProperty.call(
    response.data || {},
    "last_page"
  );
  const isLastPage = Boolean(response.data?.last_page);

  return {
    page,
    tasks: pageTasks,
    hasLastPageFlag,
    isLastPage,
  };
};

const shouldStopPagination = (pagePayload) => {
  if (!pagePayload) return true;
  if (pagePayload.isLastPage) return true;
  if (!pagePayload.hasLastPageFlag && pagePayload.tasks.length < 100) return true;
  if (pagePayload.tasks.length === 0) return true;
  return false;
};

const fetchAllTeamTasks = async (teamId, client, extraParams = {}) => {
  const tasks = [];
  let nextPage = 0;
  let shouldContinue = true;

  while (shouldContinue && nextPage < MAX_PAGES) {
    const batchPages = [];
    for (
      let index = 0;
      index < PAGE_FETCH_CONCURRENCY && nextPage + index < MAX_PAGES;
      index += 1
    ) {
      batchPages.push(nextPage + index);
    }

    const pagePayloads = await Promise.all(
      batchPages.map((page) => fetchTeamTasksPage(teamId, client, page, extraParams))
    );

    for (const payload of pagePayloads) {
      tasks.push(...payload.tasks);
      if (shouldStopPagination(payload)) {
        shouldContinue = false;
        break;
      }
    }

    nextPage += batchPages.length;
  }

  return tasks;
};

const getTeamTasksCached = async ({
  token,
  teamId,
  client,
  forceRefresh = false,
}) => {
  const cacheKey = getTaskCacheKey(token, teamId);
  const nowMs = Date.now();

  if (inflightTeamTasks.has(cacheKey)) {
    return inflightTeamTasks.get(cacheKey);
  }

  const cached = teamTasksCache.get(cacheKey);
  if (
    !forceRefresh &&
    cached &&
    nowMs - cached.cachedAtMs <= TEAM_TASKS_TTL_MS &&
    Array.isArray(cached.tasks)
  ) {
    return cached.tasks;
  }

  const fetchPromise = (async () => {
    const tasks = await fetchAllTeamTasks(teamId, client, {
      include_closed: true,
      subtasks: true,
    });

    teamTasksCache.set(cacheKey, {
      cachedAtMs: Date.now(),
      tasks,
    });

    return tasks;
  })();

  inflightTeamTasks.set(cacheKey, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    inflightTeamTasks.delete(cacheKey);
  }
};

const buildTaskCountIndex = (tasks) => {
  const counts = {
    team: tasks.length,
    spaces: new Map(),
    folders: new Map(),
    lists: new Map(),
  };

  tasks.forEach((task) => {
    const spaceId = task?.space?.id ? String(task.space.id) : "no-space";
    const folderId = task?.folder?.id ? String(task.folder.id) : null;
    const listId = task?.list?.id ? String(task.list.id) : null;

    if (spaceId) incrementMap(counts.spaces, spaceId);
    if (folderId) incrementMap(counts.folders, folderId);
    if (listId) incrementMap(counts.lists, listId);
  });

  return counts;
};

const fetchSpaceFolders = async (spaceId, client) => {
  const response = await client.get(`/space/${spaceId}/folder`, {
    params: { archived: false },
  });
  return response.data?.folders || [];
};

const fetchSpaceLists = async (spaceId, client) => {
  const response = await client.get(`/space/${spaceId}/list`, {
    params: { archived: false },
  });
  return response.data?.lists || [];
};

const fetchFolderLists = async (folderId, client) => {
  const response = await client.get(`/folder/${folderId}/list`, {
    params: { archived: false },
  });
  return response.data?.lists || [];
};

const fetchTeamNavigationTreeFromClickUp = async (teamId, client) => {
  const response = await client.get(`/team/${teamId}/space`, {
    params: { archived: false },
  });
  const spaces = response.data?.spaces || [];

  const detailedSpaces = await Promise.all(
    spaces.map(async (space) => {
      const [folders, directLists] = await Promise.all([
        fetchSpaceFolders(space.id, client).catch(() => []),
        fetchSpaceLists(space.id, client).catch(() => []),
      ]);

      const foldersWithLists = await Promise.all(
        (folders || []).map(async (folder) => {
          const lists = await fetchFolderLists(folder.id, client).catch(() => []);
          return {
            id: String(folder.id),
            name: folder.name || "Pasta sem nome",
            lists: (lists || []).map((list) => ({
              id: String(list.id),
              name: list.name || "Lista sem nome",
            })),
          };
        })
      );

      return {
        id: String(space.id),
        name: space.name || "Space sem nome",
        folders: foldersWithLists,
        lists: (directLists || []).map((list) => ({
          id: String(list.id),
          name: list.name || "Lista sem nome",
        })),
      };
    })
  );

  return detailedSpaces;
};

const toSortedArrayByName = (collection) =>
  Array.from(collection || []).sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""), "pt-BR")
  );

const cloneSpaceNode = (space) => ({
  id: String(space.id),
  name: space.name || "Space sem nome",
  folders: (space.folders || []).map((folder) => ({
    id: String(folder.id),
    name: folder.name || "Pasta sem nome",
    lists: (folder.lists || []).map((list) => ({
      id: String(list.id),
      name: list.name || "Lista sem nome",
    })),
  })),
  lists: (space.lists || []).map((list) => ({
    id: String(list.id),
    name: list.name || "Lista sem nome",
  })),
});

const buildSpacesFromTasks = (tasks) => {
  const spacesMap = new Map();

  const ensureSpace = (spaceId, spaceName) => {
    const safeId = String(spaceId || "no-space");
    if (!spacesMap.has(safeId)) {
      spacesMap.set(safeId, {
        id: safeId,
        name: String(spaceName || "").trim() || "Sem Space",
        folders: new Map(),
        lists: new Map(),
      });
    }
    return spacesMap.get(safeId);
  };

  tasks.forEach((task) => {
    const spaceId = task?.space?.id ? String(task.space.id) : "no-space";
    const spaceName = task?.space?.name || "Sem Space";
    const folderId = task?.folder?.id ? String(task.folder.id) : null;
    const folderName = task?.folder?.name || "Pasta sem nome";
    const listId = task?.list?.id ? String(task.list.id) : null;
    const listName = task?.list?.name || "Lista sem nome";

    const space = ensureSpace(spaceId, spaceName);

    if (folderId) {
      if (!space.folders.has(folderId)) {
        space.folders.set(folderId, {
          id: folderId,
          name: folderName,
          lists: new Map(),
        });
      }

      if (listId) {
        space.folders.get(folderId).lists.set(listId, {
          id: listId,
          name: listName,
        });
      }
      return;
    }

    if (listId) {
      space.lists.set(listId, {
        id: listId,
        name: listName,
      });
    }
  });

  return toSortedArrayByName(spacesMap.values()).map((space) => ({
    id: space.id,
    name: space.name,
    folders: toSortedArrayByName(space.folders.values()).map((folder) => ({
      id: folder.id,
      name: folder.name,
      lists: toSortedArrayByName(folder.lists.values()).map((list) => ({
        id: list.id,
        name: list.name,
      })),
    })),
    lists: toSortedArrayByName(space.lists.values()).map((list) => ({
      id: list.id,
      name: list.name,
    })),
  }));
};

const mergeSpaceTrees = (primarySpaces = [], fallbackSpaces = []) => {
  const mergedMap = new Map();

  const upsertPrimary = (space) => {
    mergedMap.set(String(space.id), cloneSpaceNode(space));
  };

  const upsertFallback = (space) => {
    const spaceId = String(space.id);
    if (!mergedMap.has(spaceId)) {
      mergedMap.set(spaceId, cloneSpaceNode(space));
      return;
    }

    const existing = mergedMap.get(spaceId);
    const foldersById = new Map((existing.folders || []).map((folder) => [String(folder.id), folder]));
    const listsById = new Map((existing.lists || []).map((list) => [String(list.id), list]));

    (space.folders || []).forEach((folder) => {
      const folderId = String(folder.id);
      if (!foldersById.has(folderId)) {
        foldersById.set(folderId, {
          id: folderId,
          name: folder.name || "Pasta sem nome",
          lists: (folder.lists || []).map((list) => ({
            id: String(list.id),
            name: list.name || "Lista sem nome",
          })),
        });
        return;
      }

      const existingFolder = foldersById.get(folderId);
      const folderListsById = new Map(
        (existingFolder.lists || []).map((list) => [String(list.id), list])
      );
      (folder.lists || []).forEach((list) => {
        const listId = String(list.id);
        if (!folderListsById.has(listId)) {
          folderListsById.set(listId, {
            id: listId,
            name: list.name || "Lista sem nome",
          });
        }
      });
      existingFolder.lists = toSortedArrayByName(folderListsById.values());
    });

    (space.lists || []).forEach((list) => {
      const listId = String(list.id);
      if (!listsById.has(listId)) {
        listsById.set(listId, {
          id: listId,
          name: list.name || "Lista sem nome",
        });
      }
    });

    existing.folders = toSortedArrayByName(foldersById.values());
    existing.lists = toSortedArrayByName(listsById.values());
  };

  (primarySpaces || []).forEach(upsertPrimary);
  (fallbackSpaces || []).forEach(upsertFallback);

  return toSortedArrayByName(mergedMap.values());
};

const buildNavigationTree = ({ team, spaces, counts }) => {
  const getCount = (map, id) => {
    if (!counts || !map || !id) return null;
    return map.get(id) || 0;
  };

  const rootNode = {
    id: `team:${team.id}`,
    scopeType: "team",
    scopeId: null,
    itemType: "team",
    label: "Todas as tarefas",
    taskCount: counts ? counts.team : null,
    children: (spaces || []).map((space) => ({
      id: `space:${space.id}`,
      scopeType: "space",
      scopeId: space.id,
      itemType: "space",
      label: space.name,
      taskCount: getCount(counts?.spaces, space.id),
      children: [
        ...(space.folders || []).map((folder) => ({
          id: `folder:${folder.id}`,
          scopeType: "folder",
          scopeId: folder.id,
          itemType: "folder",
          label: folder.name,
          taskCount: getCount(counts?.folders, folder.id),
          children: (folder.lists || []).map((list) => ({
            id: `list:${list.id}`,
            scopeType: "list",
            scopeId: list.id,
            itemType: "list",
            label: list.name,
            taskCount: getCount(counts?.lists, list.id),
            children: [],
          })),
        })),
        ...(space.lists || []).map((list) => ({
          id: `list:${list.id}`,
          scopeType: "list",
          scopeId: list.id,
          itemType: "list",
          label: list.name,
          taskCount: getCount(counts?.lists, list.id),
          children: [],
        })),
      ],
    })),
  };

  return [rootNode];
};

const getNavigationCacheKey = (token, teamId) => `${token || "default"}_${teamId}`;

const getNavigationCached = async ({
  token,
  team,
  client,
  forceRefresh = false,
}) => {
  const cacheKey = getNavigationCacheKey(token, team.id);
  const nowMs = Date.now();

  if (!forceRefresh) {
    const cached = navigationCache.get(cacheKey);
    if (cached) {
      const isStale = nowMs - cached.cachedAtMs > NAVIGATION_TTL_MS;
      if (isStale && !inflightNavigation.has(cacheKey)) {
        console.log(`[Nav] Servindo stale e atualizando navigation em background: ${cacheKey}`);
        const bgPromise = (async () => {
          try {
            // Recalcula em background
            const spaces = await fetchTeamNavigationTreeFromClickUp(team.id, client).catch(() => []);
            const tasksForIndex = await getTeamTasksCached({ token, teamId: team.id, client, forceRefresh: false });
            const counts = buildTaskCountIndex(tasksForIndex);
            const payload = {
              team: { id: String(team.id), name: team.name, color: team.color || null },
              generatedAt: new Date().toISOString(),
              tree: buildNavigationTree({ team, spaces, counts }),
            };
            navigationCache.set(cacheKey, { cachedAtMs: Date.now(), payload });
          } catch (e) {
            console.error(`[Nav] Erro background rewrite navigation: ${e.message}`);
          }
        })();
        inflightNavigation.set(cacheKey, bgPromise);
        bgPromise.finally(() => inflightNavigation.delete(cacheKey));
      }
      return cached.payload;
    }
  }

  if (inflightNavigation.has(cacheKey)) {
    return inflightNavigation.get(cacheKey);
  }

  const loadPromise = (async () => {
    const taskCacheKey = getTaskCacheKey(token, team.id);
    const tasksEntry = teamTasksCache.get(taskCacheKey);
    let tasksForIndex =
      tasksEntry && nowMs - tasksEntry.cachedAtMs <= TEAM_TASKS_TTL_MS
        ? tasksEntry.tasks
        : null;
    let spaces = await fetchTeamNavigationTreeFromClickUp(team.id, client).catch(() => []);

    const hasAnyNavigationItems = (spaces || []).some(
      (space) => (space?.folders || []).length > 0 || (space?.lists || []).length > 0
    );
    const shouldHydrateFromTasks = !hasAnyNavigationItems;

    if (!Array.isArray(tasksForIndex) || shouldHydrateFromTasks) {
      tasksForIndex = await getTeamTasksCached({
        token,
        teamId: team.id,
        client,
        forceRefresh: false,
      }).catch(() => tasksForIndex);
    }

    if (Array.isArray(tasksForIndex) && tasksForIndex.length) {
      const taskDerivedSpaces = buildSpacesFromTasks(tasksForIndex);
      spaces = mergeSpaceTrees(spaces, taskDerivedSpaces);
    }

    const counts = Array.isArray(tasksForIndex) ? buildTaskCountIndex(tasksForIndex) : null;

    const payload = {
      team: {
        id: String(team.id),
        name: team.name,
        color: team.color || null,
      },
      generatedAt: new Date().toISOString(),
      tree: buildNavigationTree({ team, spaces, counts }),
    };

    navigationCache.set(cacheKey, {
      cachedAtMs: Date.now(),
      payload,
    });

    return payload;
  })();

  inflightNavigation.set(cacheKey, loadPromise);

  try {
    return await loadPromise;
  } finally {
    inflightNavigation.delete(cacheKey);
  }
};

app.get("/api/teams", async (req, res) => {
  try {
    const token = resolveRequestToken(req);
    const forceRefresh =
      String(req.query.force || "").toLowerCase() === "true" ||
      String(req.query.force || "") === "1";
    const client = getClickUpClient(token);
    const teams = await getTeamsCached({
      token,
      client,
      forceRefresh,
    });
    res.json({ teams });
  } catch (error) {
    console.error("Failed to load teams:", error.response?.data || error.message);
    res.status(error.statusCode || error.response?.status || 500).json({
      error: "Failed to load teams from ClickUp",
    });
  }
});

app.get("/api/team/:teamId/space", async (req, res) => {
  try {
    const { teamId } = req.params;
    const client = getClickUpClient(resolveRequestToken(req));
    const response = await client.get(`/team/${teamId}/space`);
    res.json(response.data);
  } catch (error) {
    console.error("Failed to load spaces:", error.response?.data || error.message);
    res.status(error.statusCode || error.response?.status || 500).json({ error: "Failed to load spaces" });
  }
});

app.get("/api/team/:teamId/tasks", async (req, res) => {
  try {
    const { teamId } = req.params;
    const client = getClickUpClient(resolveRequestToken(req));
    const allPages =
      String(req.query.all_pages || "").toLowerCase() === "true" ||
      String(req.query.all_pages || "") === "1";

    const query = { ...req.query };
    delete query.all_pages;

    if (allPages) {
      const tasks = await fetchAllTeamTasks(teamId, client, query);
      return res.json({
        tasks,
        total: tasks.length,
      });
    }

    const response = await client.get(`/team/${teamId}/task`, {
      params: {
        include_closed: true,
        page: 0,
        ...query,
      },
    });
    return res.json(response.data);
  } catch (error) {
    console.error("Failed to load tasks:", error.response?.data || error.message);
    return res.status(error.statusCode || error.response?.status || 500).json({
      error: "Failed to load tasks",
    });
  }
});

app.get("/api/folder/:folderId/list", async (req, res) => {
  try {
    const { folderId } = req.params;
    const client = getClickUpClient(resolveRequestToken(req));
    const response = await client.get(`/folder/${folderId}/list`);
    res.json(response.data);
  } catch (error) {
    console.error("Failed to load lists:", error.response?.data || error.message);
    res.status(error.statusCode || error.response?.status || 500).json({ error: "Failed to load lists" });
  }
});

app.get("/api/navigation", async (req, res) => {
  try {
    const token = resolveRequestToken(req);
    const requestedTeamId = req.query.teamId ? String(req.query.teamId) : null;
    const forceRefresh =
      String(req.query.force || "").toLowerCase() === "true" ||
      String(req.query.force || "") === "1";

    const client = getClickUpClient(token);
    const team = await getTeamByIdOrDefault(requestedTeamId, token, client, forceRefresh);
    const payload = await getNavigationCached({
      token,
      team,
      client,
      forceRefresh,
    });

    return res.json(payload);
  } catch (error) {
    console.error("Failed to build navigation tree:", error.response?.data || error.message);
    return res.status(error.statusCode || error.response?.status || 500).json({
      error: "Failed to load navigation from ClickUp",
    });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const requestedTeamId = req.query.teamId ? String(req.query.teamId) : null;
    const token = resolveRequestToken(req);
    const scope = resolveScope(req.query.scopeType, req.query.scopeId);
    const dashboardFilters = resolveDashboardFilters(req.query || {});
    const forceRefresh =
      String(req.query.force || "").toLowerCase() === "true" ||
      String(req.query.force || "") === "1";

    const client = getClickUpClient(token);
    const team = await getTeamByIdOrDefault(requestedTeamId, token, client, forceRefresh);
    const cacheKey = `${token || "default"}_${team.id}_${getScopeCacheFragment(scope)}_${getFilterCacheFragment(
      dashboardFilters
    )}`;
    const nowMs = Date.now();

    const cached = dashboardCache.get(cacheKey);
    const isStale = cached && (nowMs - cached.cachedAtMs > CACHE_TTL_MS);

    // Se temos cache e não é um refresh forçado, entregamos IMEDIATAMENTE (mesmo se estiver um pouco velho)
    if (!forceRefresh && cached) {
      // Se estiver "stale" (velho), disparamos a atualização em background sem travar a resposta
      if (isStale && !inflightDashboard.has(cacheKey)) {
        console.log(`[Cache] Servindo stale e disparando background update: ${cacheKey}`);
        const backgroundPromise = (async () => {
          try {
            const allTeamTasks = await getTeamTasksCached({ token, teamId: team.id, client, forceRefresh: true });
            const scopedTasks = filterTasksByScope(allTeamTasks, scope);
            const filteredTasks = filterTasksByDashboardFilters(scopedTasks, dashboardFilters, Date.now());
            const payload = buildDashboard({ team, tasks: filteredTasks, scopedTaskCount: scopedTasks.length, dimensionBaseTasks: scopedTasks, filters: dashboardFilters, sourceTaskCount: allTeamTasks.length, scope, nowMs: Date.now() });
            dashboardCache.set(cacheKey, { cachedAtMs: Date.now(), payload });
            return payload;
          } catch (e) {
            console.error(`[Cache] Erro no background update: ${e.message}`);
          }
        })();
        inflightDashboard.set(cacheKey, backgroundPromise);
        backgroundPromise.finally(() => inflightDashboard.delete(cacheKey));
      }
      return res.json(cached.payload);
    }

    if (!forceRefresh && inflightDashboard.has(cacheKey)) {
      const pendingPayload = await inflightDashboard.get(cacheKey);
      return res.json(pendingPayload);
    }

    const buildPromise = (async () => {
      const allTeamTasks = await getTeamTasksCached({
        token,
        teamId: team.id,
        client,
        forceRefresh,
      });
      const scopedTasks = filterTasksByScope(allTeamTasks, scope);
      const filteredTasks = filterTasksByDashboardFilters(
        scopedTasks,
        dashboardFilters,
        Date.now()
      );
      const payload = buildDashboard({
        team,
        tasks: filteredTasks,
        scopedTaskCount: scopedTasks.length,
        dimensionBaseTasks: scopedTasks,
        filters: dashboardFilters,
        sourceTaskCount: allTeamTasks.length,
        scope,
        nowMs: Date.now(),
      });

      dashboardCache.set(cacheKey, {
        cachedAtMs: Date.now(),
        payload,
      });
      return payload;
    })();

    inflightDashboard.set(cacheKey, buildPromise);

    try {
      const payload = await buildPromise;
      return res.json(payload);
    } finally {
      inflightDashboard.delete(cacheKey);
    }
  } catch (error) {
    console.error("Failed to build dashboard:", error.response?.data || error.message);
    return res.status(error.statusCode || error.response?.status || 500).json({
      error: "Failed to build dashboard data",
    });
  }
});

/**
 * Webhook Receptor para ClickUp
 * Permite invalidação dinâmica de cache baseada em eventos reais.
 */
app.post("/api/webhooks/clickup", (req, res) => {
  const event = req.body;
  const teamId = event.team_id || (event.task_id ? "check_task" : null);

  console.log(`[Webhook] ClickUp [${event.event || 'unnamed'}]: Team ${teamId || 'unknown'}`);

  if (teamId) {
    let clearedCount = 0;
    const teamStr = String(teamId);

    // 1. Limpar caches de dashboard vinculados a este Team
    for (const [key] of dashboardCache) {
      if (key.includes(`_${teamStr}_`)) {
        dashboardCache.delete(key);
        clearedCount++;
      }
    }

    // 2. Limpar cache de tarefas brutas (TeamTasks)
    for (const [key] of teamTasksCache) {
      if (key.includes(teamStr)) {
        teamTasksCache.delete(key);
        clearedCount++;
      }
    }

    // 3. Limpar cache de navegação
    for (const [key] of navigationCache) {
      if (key.includes(teamStr)) {
        navigationCache.delete(key);
        clearedCount++;
      }
    }

    console.log(`[Webhook] Invalidação concluída. ${clearedCount} entradas removidas.`);
  }

  // ClickUp requer resposta rápida 200 OK para confirmar recebimento
  res.status(200).json({ status: "received", invalidated: true });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    cacheTtlMs: CACHE_TTL_MS,
    cacheKeys: dashboardCache.size,
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`ClickUp dashboard backend running on http://localhost:${PORT}`);
});
