import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Folder,
  Layers3,
  ListChecks,
  ListTodo,
  Moon,
  RefreshCcw,
  ShieldAlert,
  Sun,
  Timer,
  TrendingUp,
  Users,
  Menu,
  X,
} from "lucide-react";
import type { NavigationNode } from "./services/api";
import { type ScopeSelection, useClickUpData } from "./hooks/useClickUpData";
import {
  DonutChart,
  HorizontalBarChartKpi,
  VerticalBarChartKpi,
} from "./components/charts/TaskCharts";
import type { DashboardDetailRow } from "./services/api";
import { Skeleton, MetricSkeleton, ChartSkeleton } from "./components/Skeleton";

const REFRESH_OPTIONS = [10000, 30000, 60000];
const PERIOD_OPTIONS = [7, 14, 30, 60, 90, 180, 365];
const THEME_STORAGE_KEY = "clickup_dashboard_theme";

type DashboardTheme = "dark" | "light";

function resolveInitialTheme(): DashboardTheme {
  if (typeof window === "undefined") return "dark";

  try {
    const storedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") {
      return storedTheme;
    }
  } catch {
    // Ignore storage access failures and fallback to media preference.
  }

  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  return "dark";
}

const HOURS_PER_DAY = 24;
const formatDaysValue = (value: number) =>
  `${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}d`;

interface MetricCardModel {
  label: string;
  value: string | number;
  note: string;
  icon: ReactNode;
  tone: Tone;
}

function App() {
  const [refreshMs, setRefreshMs] = useState(30000);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // Default open
  const [theme, setTheme] = useState<DashboardTheme>(resolveInitialTheme);
  const [dashboardFilters, setDashboardFilters] = useState({
    periodDays: 365,
    status: "",
    category: "",
    assignee: "",
    priority: "",
    page: 1,
    pageSize: 50,
  });
  const {
    teams,
    selectedTeam,
    selectedTeamId,
    dashboard,
    navigationTree,
    selectedScope,
    loading,
    error,
    lastSyncAt,
    isSyncing,
    changeTeam,
    changeScope,
    prefetchScope,
    refreshNow,
  } = useClickUpData(refreshMs, dashboardFilters);

  const isLightTheme = theme === "light";

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage write failures without breaking dashboard rendering.
    }
    document.body.classList.toggle("dashboard-theme-light", isLightTheme);
  }, [isLightTheme, theme]);

  const wipPieData = useMemo(
    () =>
      (dashboard?.wipByStatus || [])
        .slice(0, 8)
        .map((item) => ({ label: item.status, value: item.value })),
    [dashboard]
  );

  const priorityData = useMemo(
    () =>
      (dashboard?.priorityQueue || []).map((item) => ({
        label: item.priority,
        value: item.value,
        color:
          item.priority === "P0"
            ? "#FF5F87"
            : item.priority === "P1"
              ? "#FFB020"
              : "#00D3FF",
      })),
    [dashboard]
  );

  const throughputData = useMemo(
    () =>
      (dashboard?.throughput.daily || []).map((item) => ({
        label: item.label,
        value: item.value,
      })),
    [dashboard]
  );

  const overdueData = useMemo(
    () =>
      (dashboard?.overdue.byAssignee || [])
        .slice(0, 8)
        .map((item) => ({ label: item.assignee, value: item.value })),
    [dashboard]
  );

  const agingData = useMemo(
    () =>
      (dashboard?.agingByStatus || [])
        .slice(0, 8)
        .map((item) => ({ label: item.status, value: item.avgHours / HOURS_PER_DAY })),
    [dashboard]
  );

  const slaPieData = useMemo(() => {
    const met = dashboard?.counters.slaMet || 0;
    const breached = dashboard?.counters.slaBreached || 0;
    return [
      { label: "SLA Cumprido", value: met, color: "#55E986" },
      { label: "SLA Estourado", value: breached, color: "#FF5F87" },
    ].filter((item) => item.value > 0);
  }, [dashboard]);

  const categoryData = useMemo(
    () =>
      (dashboard?.ticketsByCategory || [])
        .slice(0, 8)
        .map((item) => ({ label: item.category, value: item.value })),
    [dashboard]
  );

  const statusFilterOptions = useMemo(() => dashboard?.dimensions?.statuses || [], [dashboard]);
  const categoryFilterOptions = useMemo(() => dashboard?.dimensions?.categories || [], [dashboard]);
  const assigneeFilterOptions = useMemo(() => dashboard?.dimensions?.assignees || [], [dashboard]);
  const priorityFilterOptions = useMemo(() => dashboard?.dimensions?.priorities || [], [dashboard]);

  const detailRows = useMemo<DashboardDetailRow[]>(
    () => dashboard?.details?.rows || [],
    [dashboard]
  );
  const detailPage = dashboard?.details?.page || 1;
  const detailTotalPages = dashboard?.details?.totalPages || 1;
  const detailTotalRows = dashboard?.details?.totalRows || 0;
  const indicatorCatalog = dashboard?.indicatorCatalog || [];

  const metricCards = useMemo<MetricCardModel[]>(() => {
    if (!dashboard) return [];

    return [
      {
        label: "Total em Aberto (WIP)",
        value: dashboard.counters.wipTotal,
        note: `${dashboard.counters.inProgress} tarefas em execução`,
        icon: <ListChecks className="h-4 w-4" />,
        tone: "cyan",
      },
      {
        label: "Backlog",
        value: dashboard.counters.backlog,
        note: "não iniciadas",
        icon: <Clock3 className="h-4 w-4" />,
        tone: "violet",
      },
      {
        label: "Concluídas Hoje",
        value: dashboard.counters.doneToday,
        note: "throughput diário",
        icon: <CheckCircle2 className="h-4 w-4" />,
        tone: "green",
      },
      {
        label: "Concluídas na Semana",
        value: dashboard.counters.doneWeek,
        note: "throughput semanal",
        icon: <TrendingUp className="h-4 w-4" />,
        tone: "blue",
      },
      {
        label: "Atrasadas",
        value: dashboard.counters.overdueTotal,
        note: "vencidas no total",
        icon: <AlertTriangle className="h-4 w-4" />,
        tone: "orange",
      },
      {
        label: "Média Lead Time",
        value: `${dashboard.leadTime.avgDays}d`,
        note: `${dashboard.leadTime.sampleSize} tarefas concluídas`,
        icon: <Timer className="h-4 w-4" />,
        tone: "teal",
      },
      {
        label: "Média Cycle Time",
        value: `${dashboard.cycleTime.avgDays}d`,
        note: `${dashboard.cycleTime.sampleSize} tarefas iniciadas`,
        icon: <Users className="h-4 w-4" />,
        tone: "sky",
      },
      {
        label: "Retrabalho",
        value: `${dashboard.rework.ratePercent}%`,
        note: `${dashboard.rework.reopenedProxy} tarefas reabertas`,
        icon: <ShieldAlert className="h-4 w-4" />,
        tone: "pink",
      },
    ];
  }, [dashboard]);

  const updateFilter = useCallback(
    (
      key: "periodDays" | "status" | "category" | "assignee" | "priority",
      value: number | string
    ) => {
      setDashboardFilters((current) => ({
        ...current,
        [key]: value,
        page: 1,
      }));
    },
    []
  );

  const updateTablePage = useCallback((nextPage: number) => {
    setDashboardFilters((current) => ({
      ...current,
      page: Math.max(1, nextPage),
    }));
  }, []);

  const resetFilters = useCallback(() => {
    setDashboardFilters((current) => ({
      ...current,
      periodDays: 365,
      status: "",
      category: "",
      assignee: "",
      priority: "",
      page: 1,
    }));
  }, []);

  const scopedTasks = dashboard?.counters.scopedTasks ?? dashboard?.counters.totalTasks ?? 0;
  const sourceTasks = dashboard?.counters.sourceTasks ?? dashboard?.counters.totalTasks ?? 0;
  const filteredTasks = dashboard?.counters.filteredTasks ?? dashboard?.counters.totalTasks ?? 0;
  const dashboardBackdropClass = isLightTheme
    ? "bg-[radial-gradient(circle_at_20%_10%,rgba(14,165,233,0.12),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(99,102,241,0.12),transparent_36%),radial-gradient(circle_at_70%_80%,rgba(16,185,129,0.08),transparent_35%),#eef3f9]"
    : "bg-[radial-gradient(circle_at_20%_10%,rgba(0,211,255,0.12),transparent_35%),radial-gradient(circle_at_80%_20%,rgba(166,141,255,0.12),transparent_36%),radial-gradient(circle_at_70%_80%,rgba(85,233,134,0.1),transparent_35%),#020306]";

  if (loading && !dashboard) {
    return (
      <div className={`dashboard-root theme-${theme} min-h-screen ${isLightTheme ? "text-slate-900" : "text-slate-100"}`}>
        <div className={`pointer-events-none fixed inset-0 -z-10 ${dashboardBackdropClass}`} />
        <main className="mx-auto max-w-[1700px] p-4 md:p-8">
          <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="panel-rise h-fit p-3">
              <Skeleton className="h-6 w-32 mb-4" />
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            </aside>
            <div className="space-y-5">
              <header className="panel-rise p-6">
                <Skeleton className="h-4 w-40 mb-4" />
                <Skeleton className="h-10 w-64 mb-4" />
                <div className="flex gap-4">
                  <Skeleton className="h-12 flex-1" />
                  <Skeleton className="h-12 flex-1" />
                  <Skeleton className="h-12 flex-1" />
                </div>
              </header>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[1, 2, 3, 4].map(i => <MetricSkeleton key={i} />)}
              </div>
              <div className="grid gap-3 lg:grid-cols-3">
                {[1, 2, 3].map(i => <ChartSkeleton key={i} />)}
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`dashboard-root theme-${theme} min-h-screen ${isLightTheme ? "text-slate-900" : "text-slate-100"}`}>
      <div className={`pointer-events-none fixed inset-0 -z-10 ${dashboardBackdropClass}`} />

      {isSyncing && (
        <div className="fixed top-0 left-0 right-0 h-0.5 z-50 overflow-hidden">
          <div
            className="h-full bg-cyan-500 animate-[loading_1.5s_infinite] w-[30%]"
            style={{ boxShadow: "0 0 10px #00f3ff" }}
          />
        </div>
      )}

      {!isSidebarOpen && (
        <button
          onClick={() => setIsSidebarOpen(true)}
          className="dashboard-menu-toggle fixed left-4 top-4 z-[110] flex h-12 w-12 items-center justify-center rounded-sm border border-cyan-500/40 bg-black/60 text-cyan-400 shadow-[0_0_20px_rgba(0,243,255,0.2)] backdrop-blur-md transition-all hover:bg-cyan-500/20 active:scale-90 animate-panel-entry"
          title="Abrir Menu de Navegação"
        >
          <Menu className="h-6 w-6" />
          <div className="absolute inset-0 animate-pulse rounded-sm border border-cyan-500/20" />
        </button>
      )}

      <main className="mx-auto max-w-[1700px] p-4 pb-10 md:p-8">
        <div className="flex flex-col xl:flex-row gap-4 relative">
          <ScopeSidebar
            nodes={navigationTree}
            selectedScope={selectedScope}
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            onSelectScope={(scope) => {
              void changeScope(scope);
              // Auto-close drawer only on mobile/tablet (less than XL)
              if (window.innerWidth < 1280) {
                setIsSidebarOpen(false);
              }
            }}
            onPrefetchScope={prefetchScope}
          />

          <div className="flex-1 min-w-0">
            <header className="dashboard-header-shell panel-rise relative overflow-hidden border border-cyan-500/10 bg-black/40 p-5 backdrop-blur-xl md:p-6 lg:border-l-4 lg:border-l-cyan-500">
              <div className="absolute -left-20 -top-20 h-40 w-40 rounded-full bg-cyan-500/10 blur-[80px]" />
              <div className="relative flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="inline-flex items-center gap-2 border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400">
                      <span className="h-1.5 w-1.5 animate-pulse bg-cyan-400" />
                      Centro de Comando ClickUp
                    </div>
                    <h1 className="dashboard-title mt-3 font-['Space_Grotesk'] text-3xl font-extrabold tracking-tight md:text-4xl">
                      CONTROLE<span className="text-cyan-400">.FLUXO</span>
                    </h1>
                  </div>
                </div>
                <p className="dashboard-subtitle mt-2 font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-widest text-slate-400">
                    // Monitoramento de saúde operacional e metas de SLA
                </p>
                <button
                  type="button"
                  className="dashboard-theme-toggle inline-flex items-center gap-2 rounded-sm border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-all"
                  onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
                  title={isLightTheme ? "Ativar modo escuro" : "Ativar modo claro"}
                >
                  {isLightTheme ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
                  {isLightTheme ? "Modo Escuro" : "Modo Claro"}
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <label className="control-card">
                  <span className="control-label">Workspace Principal</span>
                  <select
                    className="control-input"
                    value={selectedTeamId}
                    onChange={(event) => {
                      void changeTeam(event.target.value);
                    }}
                  >
                    {teams.map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="control-card">
                  <span className="control-label">Taxa de Atualização</span>
                  <select
                    className="control-input font-mono"
                    value={refreshMs}
                    onChange={(event) => setRefreshMs(Number(event.target.value))}
                  >
                    {REFRESH_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value / 1000}s
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  className="control-card group"
                  type="button"
                  onClick={() => {
                    void refreshNow();
                  }}
                >
                  <span className="control-label uppercase">Sincronização Manual</span>
                  <span className="inline-flex items-center gap-2 text-sm font-bold text-cyan-400 transition-transform group-active:scale-95">
                    <RefreshCcw className="h-3.5 w-3.5 group-hover:rotate-180 transition-transform duration-500" />
                    SINCRONIZAR
                  </span>
                </button>
              </div>
            </header>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
              <label className="control-card">
                <span className="control-label">Periodo historico</span>
                <select
                  className="control-input font-mono"
                  value={dashboardFilters.periodDays}
                  onChange={(event) => updateFilter("periodDays", Number(event.target.value))}
                >
                  {PERIOD_OPTIONS.map((days) => (
                    <option key={days} value={days}>
                      {days}d
                    </option>
                  ))}
                </select>
              </label>

              <label className="control-card">
                <span className="control-label">Status</span>
                <select
                  className="control-input"
                  value={dashboardFilters.status}
                  onChange={(event) => updateFilter("status", event.target.value)}
                >
                  <option value="">Todos</option>
                  {statusFilterOptions.map((item) => (
                    <option key={item.label} value={item.label}>
                      {item.label} ({item.value})
                    </option>
                  ))}
                </select>
              </label>

              <label className="control-card">
                <span className="control-label">Categoria</span>
                <select
                  className="control-input"
                  value={dashboardFilters.category}
                  onChange={(event) => updateFilter("category", event.target.value)}
                >
                  <option value="">Todas</option>
                  {categoryFilterOptions.map((item) => (
                    <option key={item.label} value={item.label}>
                      {item.label} ({item.value})
                    </option>
                  ))}
                </select>
              </label>

              <label className="control-card">
                <span className="control-label">Responsavel</span>
                <select
                  className="control-input"
                  value={dashboardFilters.assignee}
                  onChange={(event) => updateFilter("assignee", event.target.value)}
                >
                  <option value="">Todos</option>
                  {assigneeFilterOptions.map((item) => (
                    <option key={item.label} value={item.label}>
                      {item.label} ({item.value})
                    </option>
                  ))}
                </select>
              </label>

              <label className="control-card">
                <span className="control-label">Prioridade</span>
                <select
                  className="control-input"
                  value={dashboardFilters.priority}
                  onChange={(event) => updateFilter("priority", event.target.value)}
                >
                  <option value="">Todas</option>
                  {priorityFilterOptions.map((item) => (
                    <option key={item.label} value={item.label}>
                      {item.label} ({item.value})
                    </option>
                  ))}
                </select>
              </label>

              <button className="control-card group" type="button" onClick={resetFilters}>
                <span className="control-label uppercase">Filtros</span>
                <span className="inline-flex items-center gap-2 text-sm font-bold text-cyan-400 transition-transform group-active:scale-95">
                  LIMPAR
                </span>
              </button>
            </div>

            <div className="dashboard-meta-row mt-6 flex flex-wrap items-center gap-4 text-[10px] font-bold uppercase tracking-tighter">
              <StatusPill label={selectedTeam?.name || "Sem conexão"} tone="cyan" />
              <StatusPill label={selectedScope.label} tone="blue" />
              <StatusPill label={`${filteredTasks}/${scopedTasks} filtro/escopo`} tone="green" />
              <StatusPill label={`${sourceTasks} base`} tone="green" />
              <div className="h-4 w-[1px] bg-white/10" />
              <div className="flex items-center gap-2 text-slate-500">
                <span className="font-mono text-cyan-500/50">ÚLTIMA_COLETA:</span>
                <span className="font-mono">{formatDateTime(lastSyncAt || dashboard?.generatedAt)}</span>
              </div>
              <div className="h-4 w-[1px] bg-white/10" />
              <div className="flex items-center gap-2 text-slate-500">
                <span className="font-mono text-cyan-500/50">INTERVALO:</span>
                <span className="font-mono">{refreshMs / 1000}s</span>
              </div>
            </div>

            {error && (
              <div className="mt-4 border-l-2 border-red-500 bg-red-500/10 px-4 py-2 text-xs font-mono text-red-400">
                [SYSTEM_ERR]: {error}
              </div>
            )}

            <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {metricCards.map((card, index) => (
                <MetricCard
                  key={card.label}
                  index={index}
                  label={card.label}
                  value={String(card.value)}
                  note={card.note}
                  icon={card.icon}
                  tone={card.tone}
                />
              ))}
            </section>

            <section className="mt-5 grid gap-3 lg:grid-cols-3">
              <Panel title="WIP por status" subtitle="Distribuicao das tarefas abertas">
                <div className="h-[260px]">
                  {wipPieData.length ? (
                    <DonutChart data={wipPieData} />
                  ) : (
                    <EmptyData message="Sem dados de status" />
                  )}
                </div>
              </Panel>

              <Panel title="Fila por prioridade" subtitle="P0 / P1 / P2">
                <div className="h-[260px]">
                  {priorityData.length ? (
                    <VerticalBarChartKpi data={priorityData} barColor="#00D3FF" />
                  ) : (
                    <EmptyData message="Sem dados de prioridade" />
                  )}
                </div>
              </Panel>

              <Panel title="Throughput 7 dias" subtitle="Concluidas por dia">
                <div className="h-[260px]">
                  {throughputData.length ? (
                    <VerticalBarChartKpi data={throughputData} barColor="#55E986" />
                  ) : (
                    <EmptyData message="Sem throughput" />
                  )}
                </div>
              </Panel>
            </section>

            <section className="mt-5 grid gap-3 lg:grid-cols-2">
              <Panel title="Aging por status" subtitle="Tempo medio (dias) no status atual">
                <div className="h-[300px]">
                  {agingData.length ? (
                    <HorizontalBarChartKpi
                      data={agingData}
                      barColor="#A68DFF"
                      valueFormatter={formatDaysValue}
                      tooltipValueLabel="TEMPO_MEDIO"
                      allowDecimalAxis
                    />
                  ) : (
                    <EmptyData message="Sem aging" />
                  )}
                </div>
              </Panel>

              <Panel title="Atrasadas por responsavel" subtitle="Overdue por dono da tarefa">
                <div className="h-[300px]">
                  {overdueData.length ? (
                    <HorizontalBarChartKpi data={overdueData} barColor="#FF5F87" />
                  ) : (
                    <EmptyData message="Sem tarefas atrasadas" />
                  )}
                </div>
              </Panel>
            </section>

            <section className="mt-5 grid gap-3 xl:grid-cols-[1.2fr_1fr]">
              <Panel title="Capacidade da Equipe" subtitle="Distribuição de carga por responsável">
                <div className="overflow-x-auto">
                  <table className="dashboard-table w-full min-w-[560px] text-left text-sm">
                    <thead className="border-b border-white/10 text-[10px] uppercase font-mono tracking-[0.2em] text-slate-500">
                      <tr>
                        <th className="pb-3 font-bold">Responsável</th>
                        <th className="pb-3">Total WIP</th>
                        <th className="pb-3">Atrasadas</th>
                        <th className="pb-3">Alta Prio</th>
                        <th className="pb-3 text-cyan-500">Índice_Carga</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-[11px]">
                      {(dashboard?.capacityByAssignee || []).slice(0, 10).map((item) => (
                        <tr
                          key={item.assignee}
                          className="border-b border-white/5 transition-colors hover:bg-white/[0.02]"
                        >
                          <td className="py-3 font-bold text-slate-200">
                            <span className="mr-2 text-cyan-500/30">{">>"}</span>
                            {item.assignee}
                          </td>
                          <td className="py-3 text-slate-400">{item.wip}</td>
                          <td className="py-3 text-slate-400">{item.overdue}</td>
                          <td className="py-3 text-slate-400">{item.highPriority}</td>
                          <td className="py-3 font-bold text-cyan-400">{item.loadScore}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!dashboard?.capacityByAssignee.length ? (
                    <EmptyData message="Nenhum dado de capacidade detectado" />
                  ) : null}
                </div>
              </Panel>

              <Panel title="Tarefas Estagnadas" subtitle="As 10 tarefas com maior tempo de parada">
                <div className="max-h-[360px] overflow-y-auto pr-2 custom-scrollbar">
                  {(dashboard?.oldestStalled || []).map((task) => (
                    <div
                      key={task.id}
                      className="group border-b border-white/5 py-3 last:border-0 hover:bg-white/[0.01] transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold uppercase tracking-wide text-slate-200 group-hover:text-cyan-400 transition-colors">
                            {task.name}
                          </p>
                          <p className="mt-1 font-mono text-[10px] text-slate-500 uppercase tracking-tighter">
                            STATUS: {task.status} // DONO: {task.assignee}
                          </p>
                        </div>
                        <span className="border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-500">
                          {task.daysStalled}D_PARADA
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 font-mono text-[9px] text-slate-600">
                        <span className="bg-slate-800 px-1">PRIORIDADE_{task.priority}</span>
                        {task.dueDate ? <span>// VENCIMENTO: {formatDate(task.dueDate)}</span> : ""}
                      </div>
                    </div>
                  ))}
                  {!dashboard?.oldestStalled.length ? (
                    <EmptyData message="Nenhuma tarefa estagnada" />
                  ) : null}
                </div>
              </Panel>
            </section>

            <section className="mt-5 grid gap-3 lg:grid-cols-3">
              <Panel title="Metas de SLA Global" subtitle="Cumprido vs Estourado">
                <div className="h-[250px]">
                  {slaPieData.length ? <DonutChart data={slaPieData} /> : <EmptyData message="Sem dados de SLA" />}
                </div>
              </Panel>

              <Panel title="Tickets por Categoria" subtitle="Agrupamento por tag ou campo">
                <div className="h-[250px]">
                  {categoryData.length ? (
                    <VerticalBarChartKpi data={categoryData} barColor="#00D3FF" />
                  ) : (
                    <EmptyData message="Sem categorias" />
                  )}
                </div>
              </Panel>

              <Panel title="Qualidade e Resposta" subtitle="Retrabalho e velocidade de retorno">
                <div className="space-y-3">
                  <InfoLine
                    title="Taxa de Retrabalho"
                    value={`${dashboard?.rework.ratePercent ?? 0}%`}
                    note={dashboard?.rework.note || ""}
                  />
                  <InfoLine
                    title="Tempo da 1ª Resposta"
                    value={
                      dashboard?.firstResponse.available
                        ? `${dashboard.firstResponse.avgHours}h`
                        : "Em coleta"
                    }
                    note={
                      dashboard?.firstResponse.available
                        ? `${dashboard.firstResponse.sampleSize} amostras analisadas`
                        : "Aguardando campo de primeira resposta"
                    }
                  />
                  <InfoLine
                    title="Lead vs Cycle"
                    value={`${dashboard?.leadTime.avgDays ?? 0}d / ${dashboard?.cycleTime.avgDays ?? 0}d`}
                    note="Lead (Criação -> Fim) | Cycle (Início -> Fim)"
                  />
                </div>
              </Panel>
            </section>

            <section className="mt-5">
              <Panel
                title="Ficha tecnica de indicadores"
                subtitle="Definicoes, formulas e regras padronizadas para leitura executiva"
              >
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {indicatorCatalog.map((indicator) => (
                    <article
                      key={indicator.id}
                      className="rounded-xl border border-white/10 bg-black/20 p-3"
                    >
                      <p className="font-['Space_Grotesk'] text-sm font-bold text-cyan-300">
                        {indicator.name}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">{indicator.definition}</p>
                      <p className="mt-3 font-mono text-[10px] text-slate-500">
                        FORMULA: {indicator.calculation.formula}
                      </p>
                      <p className="mt-1 font-mono text-[10px] text-slate-500">
                        AGREGACAO: {indicator.calculation.aggregation} // UNIDADE: {indicator.calculation.unit}
                      </p>
                      <p className="mt-2 font-mono text-[10px] text-slate-500">
                        DIMENSOES: status, categoria, responsavel, prioridade
                      </p>
                    </article>
                  ))}
                  {!indicatorCatalog.length ? (
                    <EmptyData message="Catalogo tecnico indisponivel" />
                  ) : null}
                </div>
              </Panel>
            </section>

            <section className="mt-5">
              <Panel
                title="Tabela detalhada auditavel"
                subtitle="Base de registros do indicador com filtro padronizado e exportavel"
              >
                <div className="overflow-x-auto">
                  <table className="dashboard-table w-full min-w-[1100px] text-left text-sm">
                    <thead className="border-b border-white/10 text-[10px] uppercase font-mono tracking-[0.2em] text-slate-500">
                      <tr>
                        <th className="pb-3 font-bold">ID</th>
                        <th className="pb-3 font-bold">Tarefa</th>
                        <th className="pb-3">Status</th>
                        <th className="pb-3">Categoria</th>
                        <th className="pb-3">Responsavel</th>
                        <th className="pb-3">Lista</th>
                        <th className="pb-3">Prioridade</th>
                        <th className="pb-3">Referencia</th>
                        <th className="pb-3">Vencimento</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-[11px]">
                      {detailRows.map((row) => {
                        const isOverdue = row.isOverdue;
                        const isClosed = row.isClosed || row.statusType === "closed";
                        const highlightClass = isOverdue ? "row-highlight-overdue" : isClosed ? "row-highlight-done" : "";

                        // Determinar tom do status
                        const statusTone = isClosed ? "positive" : isOverdue ? "negative" : (row.statusType === "started" || row.statusType === "active") ? "info" : "neutral";

                        return (
                          <tr
                            key={row.id || `${row.name}-${row.referenceAt || row.createdAt || ""}`}
                            className={`border-b border-white/5 transition-colors hover:bg-white/[0.04] ${highlightClass}`}
                          >
                            <td className="py-3 text-slate-500 font-mono text-[10px] pl-2">{row.id || "-"}</td>
                            <td className="py-3">
                              <div className="max-w-[400px] truncate font-bold text-slate-100 group-hover:text-cyan-400 transition-colors">
                                {row.name}
                              </div>
                            </td>
                            <td className="py-3">
                              <span className={`status-vivid status-${statusTone}`}>
                                {row.status}
                              </span>
                            </td>
                            <td className="py-3">
                              <span className="text-slate-400 px-2 py-0.5 border border-white/5 rounded-sm bg-white/5">
                                {row.category || "Sem categoria"}
                              </span>
                            </td>
                            <td className="py-3 text-slate-300 font-medium">{row.assignee || "Sem responsável"}</td>
                            <td className="py-3 text-slate-400 opacity-60">{row.list}</td>
                            <td className="py-3">
                              <span className={`font-bold ${row.priority === 'P0' ? 'text-rose-500 glow-text-red' : row.priority === 'P1' ? 'text-amber-500' : 'text-cyan-500'}`}>
                                {row.priority || "P3"}
                              </span>
                            </td>
                            <td className="py-3 text-slate-500 font-mono text-[10px]">{formatDateTime(row.referenceAt)}</td>
                            <td className={`py-3 font-mono text-[10px] ${isOverdue ? 'text-rose-500 font-bold glow-text-red' : 'text-slate-500'}`}>
                              {formatDateTime(row.dueAt)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!detailRows.length ? (
                  <div className="mt-4">
                    <EmptyData message="Nenhum registro para os filtros atuais" />
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3 font-mono text-[10px] text-slate-500">
                  <span>
                    REGISTROS: {detailTotalRows} // PAGINA: {detailPage}/{detailTotalPages}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded border border-white/10 px-2 py-1 text-slate-300 disabled:opacity-40"
                      disabled={detailPage <= 1}
                      onClick={() => updateTablePage(detailPage - 1)}
                    >
                      PREV
                    </button>
                    <button
                      type="button"
                      className="rounded border border-white/10 px-2 py-1 text-slate-300 disabled:opacity-40"
                      disabled={detailPage >= detailTotalPages}
                      onClick={() => updateTablePage(detailPage + 1)}
                    >
                      NEXT
                    </button>
                  </div>
                </div>
              </Panel>
            </section>

            <footer className="dashboard-footer-shell mt-5 border border-white/5 bg-black/40 px-4 py-3 font-mono text-[9px] uppercase tracking-widest text-slate-500">
              <div className="flex flex-col gap-1 opacity-60">
                <p>
                  <span className="text-cyan-500/50 mr-2">LOG_01:</span> {dashboard?.notes.agingMethod}
                </p>
                <p>
                  <span className="text-cyan-500/50 mr-2">LOG_02:</span> {dashboard?.notes.cycleMethod}
                </p>
              </div>
            </footer>
          </div>
        </div>
      </main >
    </div >
  );
}

type Tone = "cyan" | "violet" | "green" | "blue" | "orange" | "teal" | "sky" | "pink";

const toneClass: Record<Tone, string> = {
  cyan: "from-[#00D3FF]/35 to-[#00D3FF]/0 text-[#8DEBFF]",
  violet: "from-[#A68DFF]/35 to-[#A68DFF]/0 text-[#C9B8FF]",
  green: "from-[#55E986]/35 to-[#55E986]/0 text-[#B8FFD0]",
  blue: "from-[#47A9FF]/35 to-[#47A9FF]/0 text-[#A9DAFF]",
  orange: "from-[#FFB020]/35 to-[#FFB020]/0 text-[#FFD58A]",
  teal: "from-[#3EE2D8]/35 to-[#3EE2D8]/0 text-[#B6FFF7]",
  sky: "from-[#6BA9FF]/35 to-[#6BA9FF]/0 text-[#C0DDFF]",
  pink: "from-[#FF5F87]/35 to-[#FF5F87]/0 text-[#FFC3D1]",
};

interface ScopeSidebarProps {
  nodes: NavigationNode[];
  selectedScope: ScopeSelection;
  isOpen: boolean;
  onClose: () => void;
  onSelectScope: (scope: ScopeSelection) => void;
  onPrefetchScope: (scope: ScopeSelection) => void;
}

function ScopeSidebar({ nodes, selectedScope, isOpen, onClose, onSelectScope, onPrefetchScope }: ScopeSidebarProps) {
  return (
    <>
      {/* Mobile Backdrop Overlay - Only for fixed mobile mode */}
      <div
        className={`fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm transition-all duration-300 xl:hidden ${isOpen ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'}`}
        onClick={onClose}
      />

      <aside className={`
        scope-sidebar-shell
        fixed inset-y-0 left-0 z-[101] h-full bg-black/95 transition-all duration-300 ease-in-out
        xl:relative xl:z-0 xl:sticky xl:top-6 xl:bg-black/40 xl:backdrop-blur-md panel-rise
        ${isOpen
          ? 'w-[280px] translate-x-0 opacity-100 p-3 border-r border-white/5 visible'
          : 'w-0 -translate-x-full opacity-0 invisible pointer-events-none xl:p-0 xl:border-none'
        }
        overflow-y-auto overflow-x-hidden
      `}>
        {/* Container to prevent layout jumps inside collapsing sidebar */}
        <div className={`min-w-[256px] transition-opacity duration-200 ${isOpen ? 'opacity-100' : 'opacity-0'}`}>
          <div className="mb-6 flex items-center justify-between border-b border-white/10 pb-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-slate-500">Navegação ClickUp</p>
              <h2 className="mt-1 font-['Space_Grotesk'] text-base font-bold text-slate-100">Abas do Lead</h2>
            </div>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-white transition-colors" title="Fechar Menu">
              <X className="h-5 w-5" />
            </button>
          </div>

          {!nodes.length ? (
            <EmptyData message="Sem estrutura para este token" />
          ) : (
            <nav className="space-y-2">
              {nodes.map((node) => (
                <ScopeTreeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  selectedScope={selectedScope}
                  onSelectScope={onSelectScope}
                  onPrefetchScope={onPrefetchScope}
                />
              ))}
            </nav>
          )}
        </div>
      </aside>
    </>
  );
}

interface ScopeTreeRowProps {
  node: NavigationNode;
  depth: number;
  selectedScope: ScopeSelection;
  onSelectScope: (scope: ScopeSelection) => void;
  onPrefetchScope: (scope: ScopeSelection) => void;
}

function ScopeTreeRow({ node, depth, selectedScope, onSelectScope, onPrefetchScope }: ScopeTreeRowProps) {
  const isActive =
    node.scopeType === selectedScope.type &&
    (node.scopeType === "team"
      ? selectedScope.id === null
      : String(node.scopeId || "") === String(selectedScope.id || ""));

  const levelClass =
    node.itemType === "team" ? "sidebar-node-team" :
      node.itemType === "space" ? "sidebar-node-space" :
        node.itemType === "folder" ? "sidebar-node-folder" :
          "sidebar-node-list";

  const icon =
    node.itemType === "team" ? (
      <Layers3 className="h-3.5 w-3.5" />
    ) : node.itemType === "space" ? (
      <Building2 className="h-3.5 w-3.5" />
    ) : node.itemType === "folder" ? (
      <Folder className="h-3.5 w-3.5" />
    ) : (
      <ListTodo className="h-3.5 w-3.5" />
    );

  return (
    <div className="py-0.5">
      <button
        type="button"
        className={`group flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-all border border-transparent ${levelClass} ${isActive ? "border-cyan-500/50 bg-cyan-500/20 text-cyan-300 glow-text-cyan shadow-[0_0_15px_rgba(0,243,255,0.1)]" : "text-slate-300 hover:bg-white/5 hover:border-white/10"
          }`}
        style={{ marginLeft: `${depth * 10}px`, width: `calc(100% - ${depth * 10}px)` }}
        onClick={() =>
          onSelectScope({
            type: node.scopeType,
            id: node.scopeId,
            label: node.label,
          })
        }
        onMouseEnter={() => {
          if (!isActive && typeof onPrefetchScope === "function") {
            onPrefetchScope({
              type: node.scopeType,
              id: node.scopeId,
              label: node.label,
            });
          }
        }}
      >
        <span className={isActive ? "text-cyan-300" : "text-slate-500 group-hover:text-slate-300"}>
          {icon}
        </span>
        <span className="truncate text-xs font-medium">{node.label}</span>
        <span className="ml-auto flex items-center gap-1">
          {typeof node.taskCount === "number" ? (
            <span className="rounded border border-white/10 px-1.5 py-0.5 font-mono text-[9px] text-slate-400">
              {node.taskCount}
            </span>
          ) : null}
          {node.children?.length ? <ChevronRight className="h-3 w-3 text-slate-600" /> : null}
        </span>
      </button>

      {node.children?.length ? (
        <div className="space-y-1">
          {node.children.map((child) => (
            <ScopeTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedScope={selectedScope}
              onSelectScope={onSelectScope}
              onPrefetchScope={onPrefetchScope}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface MetricCardProps {
  index: number;
  label: string;
  value: string;
  note: string;
  icon: ReactNode;
  tone: Tone;
}

function MetricCard({ index, label, value, note, icon, tone }: MetricCardProps) {
  return (
    <article
      className="metric-card-shell panel-rise group relative overflow-hidden border border-white/5 bg-black/30 p-4 transition-all hover:border-cyan-500/30 lg:border-b-2 lg:border-b-white/5 hover:lg:border-b-cyan-500"
      style={{
        animationDelay: `${index * 50}ms`,
        clipPath: "polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%)",
      }}
    >
      <div className="flex items-center justify-between">
        <div className={`p-1.5 opacity-80 group-hover:opacity-100 transition-opacity ${toneClass[tone].split(" ").pop()}`}>
          {icon}
        </div>
        <div className="h-1 w-8 bg-white/5 group-hover:bg-cyan-500/20 transition-colors" />
      </div>
      <p className="mt-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500 group-hover:text-slate-400 transition-colors">
        {label}
      </p>
      <p className="mt-2 font-mono text-3xl font-bold tracking-tighter text-slate-100 group-hover:text-cyan-400 transition-all">
        {value}
      </p>
      <div className="mt-3 flex items-center gap-2">
        <div className="h-[1px] w-2 bg-slate-700" />
        <p className="font-mono text-[9px] uppercase tracking-wider text-slate-500">{note}</p>
      </div>
    </article>
  );
}

interface PanelProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

function Panel({ title, subtitle, children }: PanelProps) {
  return (
    <section className="panel-shell panel-rise animate-panel-entry relative overflow-hidden border border-white/5 bg-black/20 p-4 backdrop-blur-sm md:p-5">
      <div className="absolute right-0 top-0 h-8 w-8 border-r border-t border-cyan-500/10" />
      <div className="mb-6 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <div className="h-3 w-[2px] bg-cyan-500" />
          <h2 className="font-['Space_Grotesk'] text-sm font-bold uppercase tracking-wider text-slate-200">{title}</h2>
        </div>
        <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-slate-500">{subtitle}</p>
      </div>
      <div className="relative">{children}</div>
    </section>
  );
}

interface StatusPillProps {
  label: string;
  tone: "cyan" | "blue" | "green";
}

function StatusPill({ label, tone }: StatusPillProps) {
  const toneStyle: Record<StatusPillProps["tone"], string> = {
    cyan: "border-cyan-500/20 bg-cyan-500/5 text-cyan-400",
    blue: "border-blue-500/20 bg-blue-500/5 text-blue-400",
    green: "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
  };

  return (
    <span className={`status-pill-shell inline-flex items-center gap-2 border px-2 py-0.5 font-mono text-[10px] ${toneStyle[tone]}`}>
      <span className="h-1 w-1 bg-current" />
      {label}
    </span>
  );
}

interface InfoLineProps {
  title: string;
  value: string;
  note: string;
}

function InfoLine({ title, value, note }: InfoLineProps) {
  return (
    <div className="info-line-shell rounded-xl border border-white/10 bg-black/20 p-3">
      <p className="text-[11px] uppercase tracking-[0.12em] text-slate-400">{title}</p>
      <p className="mt-2 font-['Space_Grotesk'] text-2xl font-semibold text-slate-100">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{note}</p>
    </div>
  );
}

function EmptyData({ message }: { message: string }) {
  return (
    <div className="empty-data-shell flex h-full min-h-[120px] items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">
      {message}
    </div>
  );
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("pt-BR");
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}

export default App;
