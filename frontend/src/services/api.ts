import axios from "axios";

function resolveApiBaseUrl(): string {
  const envBaseUrl = String(import.meta.env.VITE_API_BASE_URL || "").trim();
  if (envBaseUrl) return envBaseUrl;

  if (typeof window === "undefined") {
    return "http://localhost:3001/api";
  }

  const protocol = window.location.protocol || "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:3001/api`;
}

const API_BASE_URL = resolveApiBaseUrl();
const API_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 45000);

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
});

const normalizeToken = (rawToken?: string | null) =>
  String(rawToken || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

const buildAuthHeaders = (rawToken?: string | null) => {
  const token = normalizeToken(rawToken);
  return token ? { Authorization: token } : {};
};

const buildTokenParam = (rawToken?: string | null) => {
  const token = normalizeToken(rawToken);
  return token ? { token } : {};
};

export interface ClickUpTeam {
  id: string;
  name: string;
  color?: string | null;
}

export type ScopeType = "team" | "space" | "folder" | "list";

export interface DashboardScope {
  type: ScopeType;
  id: string | null;
  label: string;
}

export interface NavigationNode {
  id: string;
  scopeType: ScopeType;
  scopeId: string | null;
  itemType: ScopeType;
  label: string;
  taskCount: number | null;
  children: NavigationNode[];
}

export interface NavigationPayload {
  team: ClickUpTeam;
  generatedAt: string;
  tree: NavigationNode[];
}

export interface CounterBlock {
  sourceTasks: number;
  scopedTasks: number;
  totalTasks: number;
  filteredTasks?: number;
  wipTotal: number;
  backlog: number;
  inProgress: number;
  waiting: number;
  doneToday: number;
  doneWeek: number;
  overdueTotal: number;
  slaMet: number;
  slaBreached: number;
  reworkRatePercent: number;
}

export interface StatusValue {
  status: string;
  value: number;
}

export interface PriorityValue {
  priority: string;
  value: number;
}

export interface ThroughputPoint {
  label: string;
  date: string;
  value: number;
}

export interface AssigneeValue {
  assignee: string;
  value: number;
}

export interface AgingPoint {
  status: string;
  tasks: number;
  avgHours: number;
}

export interface TimeMetric {
  avgHours: number;
  avgDays: number;
  sampleSize: number;
}

export interface StalledTask {
  id: string;
  name: string;
  status: string;
  assignee: string;
  daysStalled: number;
  dueDate: string | null;
  priority: string;
  url: string | null;
}

export interface CapacityPoint {
  assignee: string;
  wip: number;
  overdue: number;
  highPriority: number;
  loadScore: number;
}

export interface SlaGroup {
  group: string;
  met: number;
  breached: number;
  total: number;
  complianceRate: number;
}

export interface CategoryValue {
  category: string;
  value: number;
}

export interface FirstResponseBlock {
  available: boolean;
  avgHours: number;
  sampleSize: number;
}

export interface ReworkBlock {
  reopenedProxy: number;
  base: number;
  ratePercent: number;
  note: string;
}

export interface DimensionEntry {
  label: string;
  value: number;
}

export interface DashboardDimensions {
  statuses: DimensionEntry[];
  categories: DimensionEntry[];
  priorities: DimensionEntry[];
  assignees: DimensionEntry[];
}

export interface DashboardDetailRow {
  id: string;
  name: string;
  url: string | null;
  status: string;
  statusType: string;
  category: string;
  priority: string;
  assignees: string[];
  assignee: string;
  spaceId: string | null;
  space: string;
  folderId: string | null;
  folder: string;
  listId: string | null;
  list: string;
  group: string;
  isClosed: boolean;
  isOverdue: boolean;
  referenceAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  statusChangedAt: string | null;
  startAt: string | null;
  dueAt: string | null;
  closedAt: string | null;
  statusAgeHours: number;
  leadTimeHours: number | null;
  cycleTimeHours: number | null;
}

export interface DashboardDetails {
  rows: DashboardDetailRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}

export interface DashboardFiltersApplied {
  periodDays: number;
  status: string | null;
  category: string | null;
  assignee: string | null;
  priority: string | null;
}

export interface DashboardIndicatorSpec {
  id: string;
  name: string;
  definition: string;
  source: {
    collections: string[];
    fields: string[];
    relationships: string[];
    includeRules: string[];
  };
  calculation: {
    formula: string;
    aggregation: string;
    unit: string;
    nullHandling: string;
  };
  visualization: {
    historical: string;
    distribution: string[];
    detailTable: string;
  };
}

export interface DashboardValidation {
  chartTableConsistent: boolean;
  statusAndCategoryFilterable: boolean;
  auditTableAvailable: boolean;
  historicalAvailable: boolean;
}

export interface DashboardPayload {
  team: ClickUpTeam;
  scope: DashboardScope;
  generatedAt: string;
  counters: CounterBlock;
  wipByStatus: StatusValue[];
  flowBuckets: StatusValue[];
  throughput: {
    doneToday: number;
    doneWeek: number;
    daily: ThroughputPoint[];
  };
  overdue: {
    total: number;
    byAssignee: AssigneeValue[];
  };
  agingByStatus: AgingPoint[];
  leadTime: TimeMetric;
  cycleTime: TimeMetric;
  oldestStalled: StalledTask[];
  capacityByAssignee: CapacityPoint[];
  priorityQueue: PriorityValue[];
  rework: ReworkBlock;
  slaByGroup: SlaGroup[];
  ticketsByCategory: CategoryValue[];
  firstResponse: FirstResponseBlock;
  notes: {
    agingMethod: string;
    cycleMethod: string;
  };
  filters?: {
    applied: DashboardFiltersApplied;
  };
  dimensions?: DashboardDimensions;
  details?: DashboardDetails;
  indicatorCatalog?: DashboardIndicatorSpec[];
  validation?: DashboardValidation;
}

export const getTeams = async (token?: string | null) => {
  const response = await apiClient.get<{ teams: ClickUpTeam[] }>("/teams", {
    params: {
      ...buildTokenParam(token),
    },
    headers: buildAuthHeaders(token),
  });
  return response.data;
};

interface GetDashboardParams {
  teamId?: string;
  force?: boolean;
  token?: string | null;
  scopeType?: ScopeType;
  scopeId?: string | null;
  periodDays?: number;
  status?: string;
  category?: string;
  assignee?: string;
  priority?: string;
  page?: number;
  pageSize?: number;
}

export const getNavigation = async (
  teamId?: string,
  token?: string | null,
  force = false
) => {
  const response = await apiClient.get<NavigationPayload>("/navigation", {
    params: {
      teamId,
      force,
      ...buildTokenParam(token),
    },
    headers: buildAuthHeaders(token),
  });
  return response.data;
};

export const getDashboard = async ({
  teamId,
  force = false,
  token,
  scopeType = "team",
  scopeId = null,
  periodDays,
  status,
  category,
  assignee,
  priority,
  page,
  pageSize,
}: GetDashboardParams = {}) => {
  const response = await apiClient.get<DashboardPayload>("/dashboard", {
    params: {
      teamId,
      force,
      scopeType,
      scopeId,
      periodDays,
      status,
      category,
      assignee,
      priority,
      page,
      pageSize,
      ...buildTokenParam(token),
    },
    headers: buildAuthHeaders(token),
  });
  return response.data;
};
