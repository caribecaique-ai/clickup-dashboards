import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClickUpTeam,
  DashboardPayload,
  NavigationNode,
  ScopeType,
  getDashboard,
  getNavigation,
  getTeams,
} from "../services/api";

interface LoadOptions {
  silent?: boolean;
  force?: boolean;
}

export interface ScopeSelection {
  type: ScopeType;
  id: string | null;
  label: string;
}

export interface DashboardFilters {
  periodDays: number;
  status: string;
  category: string;
  assignee: string;
  priority: string;
  page: number;
  pageSize: number;
}

const TOKEN_STORAGE_KEY = "clickup_dashboard_token";
const TEAM_STORAGE_KEY = "clickup_dashboard_selected_team";
const SCOPE_TYPE_STORAGE_KEY = "clickup_dashboard_scope_type";
const SCOPE_ID_STORAGE_KEY = "clickup_dashboard_scope_id";

const normalizeToken = (rawToken?: string | null) =>
  String(rawToken || "")
    .replace(/^Bearer\s+/i, "")
    .trim();

const normalizeScopeType = (rawType?: string | null): ScopeType => {
  const value = String(rawType || "team").toLowerCase();
  if (value === "space" || value === "folder" || value === "list") return value;
  return "team";
};

const readSessionStorage = (key: string): string => {
  try {
    return sessionStorage.getItem(key) || "";
  } catch {
    return "";
  }
};

const writeSessionStorage = (key: string, value: string): void => {
  try {
    if (value) sessionStorage.setItem(key, value);
    else sessionStorage.removeItem(key);
  } catch {
    // Ignore browser storage restrictions.
  }
};

const buildScope = (type: ScopeType, id?: string | null, label?: string): ScopeSelection => {
  const normalizedId = String(id || "").trim() || null;
  if (type === "team" || !normalizedId) {
    return {
      type: "team",
      id: null,
      label: label || "Todas as tarefas",
    };
  }

  return {
    type,
    id: normalizedId,
    label: label || `Escopo ${normalizedId}`,
  };
};

const getScopeKey = (teamId: string, scope: ScopeSelection) =>
  `${teamId}::${scope.type}::${scope.id || "all"}`;

const normalizeFilterText = (value?: string | null) => String(value || "").trim();

const normalizePositiveInt = (value: unknown, fallback: number, min = 1, max = 100000) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
};

const normalizeDashboardFilters = (rawFilters?: Partial<DashboardFilters>): DashboardFilters => ({
  periodDays: normalizePositiveInt(rawFilters?.periodDays, 365, 1, 3650),
  status: normalizeFilterText(rawFilters?.status),
  category: normalizeFilterText(rawFilters?.category),
  assignee: normalizeFilterText(rawFilters?.assignee),
  priority: normalizeFilterText(rawFilters?.priority),
  page: normalizePositiveInt(rawFilters?.page, 1, 1, 100000),
  pageSize: normalizePositiveInt(rawFilters?.pageSize, 50, 10, 200),
});

const getFilterKey = (filters: DashboardFilters) =>
  [
    `period:${filters.periodDays}`,
    `status:${filters.status || "all"}`,
    `category:${filters.category || "all"}`,
    `assignee:${filters.assignee || "all"}`,
    `priority:${filters.priority || "all"}`,
    `page:${filters.page}`,
    `pageSize:${filters.pageSize}`,
  ].join("|");

const findScopeNode = (
  nodes: NavigationNode[],
  scope: ScopeSelection
): NavigationNode | null => {
  for (const node of nodes) {
    const sameType = node.scopeType === scope.type;
    const sameId =
      node.scopeType === "team"
        ? scope.id === null
        : String(node.scopeId || "") === String(scope.id || "");
    if (sameType && sameId) return node;

    const foundInChildren = findScopeNode(node.children || [], scope);
    if (foundInChildren) return foundInChildren;
  }
  return null;
};

const buildMinimalNavigationTree = (teamId: string, taskCount: number | null): NavigationNode[] => [
  {
    id: `team:${teamId || "unknown"}`,
    scopeType: "team",
    scopeId: null,
    itemType: "team",
    label: "Todas as tarefas",
    taskCount,
    children: [],
  },
];

export const useClickUpData = (refreshMs = 30000, dashboardFilters?: Partial<DashboardFilters>) => {
  const normalizedFilters = useMemo(
    () => normalizeDashboardFilters(dashboardFilters),
    [
      dashboardFilters?.periodDays,
      dashboardFilters?.status,
      dashboardFilters?.category,
      dashboardFilters?.assignee,
      dashboardFilters?.priority,
      dashboardFilters?.page,
      dashboardFilters?.pageSize,
    ]
  );
  const filterKey = useMemo(() => getFilterKey(normalizedFilters), [normalizedFilters]);

  const [teams, setTeams] = useState<ClickUpTeam[]>([]);
  const [authToken, setAuthToken] = useState<string>(() => readSessionStorage(TOKEN_STORAGE_KEY));
  const [selectedTeamId, setSelectedTeamId] = useState<string>(() => readSessionStorage(TEAM_STORAGE_KEY));
  const [selectedScope, setSelectedScope] = useState<ScopeSelection>(() =>
    buildScope(
      normalizeScopeType(readSessionStorage(SCOPE_TYPE_STORAGE_KEY)),
      readSessionStorage(SCOPE_ID_STORAGE_KEY),
      "Todas as tarefas"
    )
  );
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [navigationByTeam, setNavigationByTeam] = useState<Record<string, NavigationNode[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const authTokenRef = useRef(authToken);
  const dashboardFiltersRef = useRef(normalizedFilters);
  const previousFilterKeyRef = useRef(filterKey);
  const dashboardCacheRef = useRef<Map<string, DashboardPayload>>(new Map());
  const navigationCacheRef = useRef<Map<string, NavigationNode[]>>(new Map());

  useEffect(() => {
    authTokenRef.current = authToken;
  }, [authToken]);

  useEffect(() => {
    dashboardFiltersRef.current = normalizedFilters;
  }, [normalizedFilters]);

  const selectedTeam = useMemo(
    () => teams.find((team) => String(team.id) === String(selectedTeamId)) || null,
    [teams, selectedTeamId]
  );

  const navigationTree = useMemo(
    () => navigationByTeam[selectedTeamId] || [],
    [navigationByTeam, selectedTeamId]
  );

  const activeScopeNode = useMemo(
    () => findScopeNode(navigationTree, selectedScope),
    [navigationTree, selectedScope]
  );

  const persistScope = useCallback((scope: ScopeSelection) => {
    writeSessionStorage(SCOPE_TYPE_STORAGE_KEY, scope.type);
    writeSessionStorage(SCOPE_ID_STORAGE_KEY, scope.id || "");
  }, []);

  const syncUrlWithState = useCallback((teamId: string, scope: ScopeSelection) => {
    const url = new URL(window.location.href);
    if (teamId) url.searchParams.set("teamId", teamId);
    else url.searchParams.delete("teamId");

    url.searchParams.set("scopeType", scope.type);
    if (scope.id) url.searchParams.set("scopeId", scope.id);
    else url.searchParams.delete("scopeId");

    window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  }, []);

  const loadNavigation = useCallback(
    async (teamId: string, token: string, force = false): Promise<NavigationNode[]> => {
      if (!teamId || !token) return [];

      const cacheKey = String(teamId);
      if (!force && navigationCacheRef.current.has(cacheKey)) {
        const cachedTree = navigationCacheRef.current.get(cacheKey) || [];
        setNavigationByTeam((current) =>
          current[cacheKey] ? current : { ...current, [cacheKey]: cachedTree }
        );
        return cachedTree;
      }

      const response = await getNavigation(teamId, token, force);
      const tree = response.tree || [];
      navigationCacheRef.current.set(cacheKey, tree);
      setNavigationByTeam((current) => ({ ...current, [cacheKey]: tree }));
      return tree;
    },
    []
  );

  const loadDashboardForScope = useCallback(
    async (
      teamId: string,
      scope: ScopeSelection,
      options: LoadOptions = {},
      tokenOverride?: string
    ): Promise<DashboardPayload | undefined> => {
      const token = normalizeToken(tokenOverride || authTokenRef.current);
      if (!token) return undefined;

      const { silent = true, force = false } = options;
      const resolvedTeamId = String(teamId || "").trim() || "__auto__";
      const runtimeFilters = dashboardFiltersRef.current;
      const cacheKey = `${getScopeKey(resolvedTeamId, scope)}::${getFilterKey(runtimeFilters)}`;
      const cachedPayload = dashboardCacheRef.current.get(cacheKey);

      if (cachedPayload && !force) {
        setDashboard(cachedPayload);
        setLastSyncAt(new Date().toISOString());
        setError(null);

        if (silent) {
          return cachedPayload;
        }
      }

      if (!silent && !cachedPayload) setLoading(true);
      setIsSyncing(true);

      try {
        const dashboardData = await getDashboard({
          teamId: String(teamId || "").trim() || undefined,
          force,
          token,
          scopeType: scope.type,
          scopeId: scope.id,
          periodDays: runtimeFilters.periodDays,
          status: runtimeFilters.status || undefined,
          category: runtimeFilters.category || undefined,
          assignee: runtimeFilters.assignee || undefined,
          priority: runtimeFilters.priority || undefined,
          page: runtimeFilters.page,
          pageSize: runtimeFilters.pageSize,
        });

        dashboardCacheRef.current.set(cacheKey, dashboardData);
        setDashboard(dashboardData);
        setLastSyncAt(new Date().toISOString());
        setError(null);
        return dashboardData;
      } catch (err: any) {
        setError(err?.response?.data?.error || err?.message || "Falha ao carregar dashboard");
        return undefined;
      } finally {
        if (!silent) setLoading(false);
        setIsSyncing(false);
      }
    },
    []
  );

  useEffect(() => {
    let active = true;

    const bootstrap = async () => {
      setLoading(true);
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlToken = normalizeToken(urlParams.get("token"));
        const urlTeamId = String(urlParams.get("teamId") || "").trim();
        const urlScopeType = normalizeScopeType(urlParams.get("scopeType"));
        const urlScopeId = String(urlParams.get("scopeId") || "").trim() || null;
        const tokenToUse =
          urlToken ||
          normalizeToken(authTokenRef.current) ||
          normalizeToken(readSessionStorage(TOKEN_STORAGE_KEY));

        if (!tokenToUse) {
          setError("Token ClickUp ausente. Abra o dashboard pela URL gerada no manager.");
          return;
        }

        writeSessionStorage(TOKEN_STORAGE_KEY, tokenToUse);

        const persistedScope = buildScope(
          normalizeScopeType(readSessionStorage(SCOPE_TYPE_STORAGE_KEY)),
          readSessionStorage(SCOPE_ID_STORAGE_KEY),
          "Todas as tarefas"
        );

        const requestedScope = buildScope(
          urlScopeType,
          urlScopeId,
          persistedScope.label || "Todas as tarefas"
        );

        const provisionalTeamId = urlTeamId || readSessionStorage(TEAM_STORAGE_KEY);
        const teamScope = buildScope("team", null, "Todas as tarefas");
        setSelectedScope(teamScope);
        persistScope(teamScope);
        if (provisionalTeamId) {
          setSelectedTeamId(provisionalTeamId);
          writeSessionStorage(TEAM_STORAGE_KEY, provisionalTeamId);
          syncUrlWithState(provisionalTeamId, teamScope);
        }

        let fetchedTeams: ClickUpTeam[] = [];
        let teamsLoadError: string | null = null;
        try {
          const teamsData = await getTeams(tokenToUse);
          if (!active) return;
          fetchedTeams = teamsData.teams || [];
          setTeams(fetchedTeams);
        } catch (teamErr: any) {
          if (!active) return;
          fetchedTeams = [];
          setTeams([]);
          teamsLoadError =
            teamErr?.response?.data?.error || teamErr?.message || "Falha ao carregar workspaces";
        }

        let teamIdToLoad = provisionalTeamId;
        if (fetchedTeams.length) {
          const hasValidTeam = fetchedTeams.some((team) => String(team.id) === String(teamIdToLoad));
          if (!teamIdToLoad || !hasValidTeam) {
            teamIdToLoad = String(fetchedTeams[0].id);
          }
        }

        const dashboardData = await loadDashboardForScope(
          teamIdToLoad,
          teamScope,
          { silent: false, force: false },
          tokenToUse
        );

        if (!teamIdToLoad && dashboardData?.team?.id) {
          teamIdToLoad = String(dashboardData.team.id);
        }

        if (!teamIdToLoad) {
          setError(
            teamsLoadError || "Nao foi possivel identificar o workspace. Reconecte o cliente no manager."
          );
          return;
        }

        setSelectedTeamId(teamIdToLoad);
        writeSessionStorage(TEAM_STORAGE_KEY, teamIdToLoad);

        if (!fetchedTeams.length && dashboardData?.team) {
          setTeams([
            {
              id: String(dashboardData.team.id),
              name: dashboardData.team.name,
              color: dashboardData.team.color || null,
            },
          ]);
        }

        let navigationTreeData = await loadNavigation(teamIdToLoad, tokenToUse, false).catch(() => []);
        if (!navigationTreeData.length) {
          navigationTreeData = await loadNavigation(teamIdToLoad, tokenToUse, true).catch(() => []);
        }
        if (!navigationTreeData.length) {
          const fallbackTree = buildMinimalNavigationTree(
            teamIdToLoad,
            dashboardData?.counters?.totalTasks ?? null
          );
          navigationCacheRef.current.set(teamIdToLoad, fallbackTree);
          setNavigationByTeam((current) => ({ ...current, [teamIdToLoad]: fallbackTree }));
          navigationTreeData = fallbackTree;
        }

        const validScopeNode =
          findScopeNode(navigationTreeData, requestedScope) ||
          findScopeNode(navigationTreeData, persistedScope);

        const effectiveScope = validScopeNode
          ? buildScope(
            validScopeNode.scopeType,
            validScopeNode.scopeId,
            validScopeNode.label
          )
          : teamScope;

        const shouldSwitchScope =
          effectiveScope.type !== teamScope.type || effectiveScope.id !== teamScope.id;

        if (shouldSwitchScope) {
          setSelectedScope(effectiveScope);
          persistScope(effectiveScope);
          syncUrlWithState(teamIdToLoad, effectiveScope);
          await loadDashboardForScope(
            teamIdToLoad,
            effectiveScope,
            { silent: true, force: false },
            tokenToUse
          );
        } else {
          syncUrlWithState(teamIdToLoad, teamScope);
        }

        if (!active) return;
        if (tokenToUse !== authTokenRef.current) {
          setAuthToken(tokenToUse);
        }
      } catch (err: any) {
        if (!active) return;
        setError(err?.response?.data?.error || err?.message || "Falha ao inicializar dashboard");
      } finally {
        setLoading(false);
      }
    };

    void bootstrap();

    return () => {
      active = false;
    };
  }, [loadDashboardForScope, loadNavigation, persistScope, syncUrlWithState]);

  useEffect(() => {
    if (!activeScopeNode) return;

    const normalized = buildScope(activeScopeNode.scopeType, activeScopeNode.scopeId, activeScopeNode.label);
    if (
      normalized.type !== selectedScope.type ||
      normalized.id !== selectedScope.id ||
      normalized.label !== selectedScope.label
    ) {
      setSelectedScope(normalized);
      persistScope(normalized);
    }
  }, [activeScopeNode, selectedScope, persistScope]);

  useEffect(() => {
    if (previousFilterKeyRef.current === filterKey) return;
    previousFilterKeyRef.current = filterKey;

    if (!selectedTeamId || !normalizeToken(authTokenRef.current)) return;
    setError(null);
    void loadDashboardForScope(selectedTeamId, selectedScope, {
      silent: false,
      force: true,
    });
  }, [filterKey, selectedTeamId, selectedScope, loadDashboardForScope]);

  useEffect(() => {
    if (!loading || dashboard) return undefined;

    const timeoutId = window.setTimeout(() => {
      setLoading(false);
      setError((current) => current || "Timeout ao carregar dados do ClickUp. Valide token e conectividade.");
    }, 20000);

    return () => window.clearTimeout(timeoutId);
  }, [loading, dashboard]);

  useEffect(() => {
    if (!selectedTeamId || !normalizeToken(authToken)) return undefined;

    const intervalId = setInterval(() => {
      const token = normalizeToken(authTokenRef.current);
      if (token) {
        void loadNavigation(selectedTeamId, token, true);
      }
      void loadDashboardForScope(selectedTeamId, selectedScope, { silent: true, force: true });
    }, refreshMs);

    return () => clearInterval(intervalId);
  }, [selectedTeamId, selectedScope, authToken, refreshMs, loadDashboardForScope, loadNavigation]);

  const changeTeam = useCallback(
    async (teamId: string) => {
      const token = normalizeToken(authToken);
      if (!teamId || !token) return;

      const teamScope = buildScope("team", null, "Todas as tarefas");

      setSelectedTeamId(teamId);
      writeSessionStorage(TEAM_STORAGE_KEY, teamId);
      setSelectedScope(teamScope);
      persistScope(teamScope);
      syncUrlWithState(teamId, teamScope);

      setError(null);
      let tree = await loadNavigation(teamId, token, false).catch(() => []);
      const payload = await loadDashboardForScope(teamId, teamScope, { silent: false, force: false }, token);
      if (!tree.length) {
        tree = await loadNavigation(teamId, token, true).catch(() => []);
      }
      if (!tree.length) {
        const fallbackTree = buildMinimalNavigationTree(teamId, payload?.counters?.totalTasks ?? null);
        navigationCacheRef.current.set(teamId, fallbackTree);
        setNavigationByTeam((current) => ({ ...current, [teamId]: fallbackTree }));
      }
    },
    [authToken, loadNavigation, loadDashboardForScope, persistScope, syncUrlWithState]
  );

  const changeScope = useCallback(
    async (scope: ScopeSelection) => {
      if (!selectedTeamId) return;
      const normalized = buildScope(scope.type, scope.id, scope.label);

      setSelectedScope(normalized);
      persistScope(normalized);
      syncUrlWithState(selectedTeamId, normalized);
      setError(null);

      await loadDashboardForScope(selectedTeamId, normalized, {
        silent: false,
        force: false,
      });
    },
    [selectedTeamId, loadDashboardForScope, persistScope, syncUrlWithState]
  );

  const prefetchScope = useCallback(
    async (scope: ScopeSelection) => {
      if (!selectedTeamId) return;
      const token = normalizeToken(authTokenRef.current);
      if (!token) return;

      const runtimeFilters = dashboardFiltersRef.current;
      const cacheKey = `${getScopeKey(selectedTeamId, scope)}::${getFilterKey(runtimeFilters)}`;

      if (dashboardCacheRef.current.has(cacheKey)) return;

      try {
        const dashboardData = await getDashboard({
          teamId: selectedTeamId,
          token,
          scopeType: scope.type,
          scopeId: scope.id,
          periodDays: runtimeFilters.periodDays,
          status: runtimeFilters.status || undefined,
          category: runtimeFilters.category || undefined,
          assignee: runtimeFilters.assignee || undefined,
          priority: runtimeFilters.priority || undefined,
          page: runtimeFilters.page,
          pageSize: runtimeFilters.pageSize,
        });
        dashboardCacheRef.current.set(cacheKey, dashboardData);
      } catch (err) {
        // Silently ignore prefetch errors
      }
    },
    [selectedTeamId]
  );

  const refreshNow = useCallback(async () => {
    if (!selectedTeamId) return;
    const token = normalizeToken(authToken);
    if (!token) return;

    const tree = await loadNavigation(selectedTeamId, token, true).catch(() => []);
    const payload = await loadDashboardForScope(selectedTeamId, selectedScope, {
      silent: false,
      force: true,
    });
    if (!tree.length) {
      const fallbackTree = buildMinimalNavigationTree(
        selectedTeamId,
        payload?.counters?.totalTasks ?? null
      );
      navigationCacheRef.current.set(selectedTeamId, fallbackTree);
      setNavigationByTeam((current) => ({ ...current, [selectedTeamId]: fallbackTree }));
    }
  }, [selectedTeamId, selectedScope, authToken, loadNavigation, loadDashboardForScope]);

  return {
    teams,
    selectedTeam,
    selectedTeamId,
    dashboard,
    filters: normalizedFilters,
    navigationTree,
    selectedScope,
    activeScopeNode,
    loading,
    error,
    isSyncing,
    lastSyncAt,
    changeTeam,
    changeScope,
    prefetchScope,
    refreshNow,
  };
};
