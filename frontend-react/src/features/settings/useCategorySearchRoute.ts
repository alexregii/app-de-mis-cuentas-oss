import {useEffect, useMemo, useState} from "react";
import type {Category} from "../../shared/model/categories";
import {settingsApi} from "./api";
import type {SettingsRouteState} from "./settingsRoute";

export type CategorySearchRouteStatus = "idle" | "loading" | "resolved" | "missing" | "error";

type Resolution = {id: number | null; status: CategorySearchRouteStatus; categories: Category[]};
const emptyCategories: Category[] = [];

export function useCategorySearchRoute(route: Pick<SettingsRouteState, "categoryRequested" | "categoryId">, bootstrapCategories: Category[]) {
  const existsInBootstrap = route.categoryId !== null && bootstrapCategories.some((category) => category.id === route.categoryId);
  const [resolution, setResolution] = useState<Resolution>({id: null, status: "idle", categories: []});
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!route.categoryRequested) {
      setResolution({id: null, status: "idle", categories: []});
      return;
    }
    if (route.categoryId === null) {
      setResolution({id: null, status: "missing", categories: []});
      return;
    }
    if (existsInBootstrap) {
      setResolution({id: route.categoryId, status: "resolved", categories: []});
      return;
    }

    let cancelled = false;
    setResolution({id: route.categoryId, status: "loading", categories: []});
    settingsApi.categories({cache: "no-store"})
      .then(({categories}) => {
        if (cancelled) return;
        setResolution({
          id: route.categoryId,
          status: categories.some((category) => category.id === route.categoryId) ? "resolved" : "missing",
          categories,
        });
      })
      .catch(() => {
        if (!cancelled) setResolution({id: route.categoryId, status: "error", categories: []});
      });
    return () => { cancelled = true; };
  }, [existsInBootstrap, retryToken, route.categoryId, route.categoryRequested]);

  const status = !route.categoryRequested
    ? "idle"
    : route.categoryId === null
      ? "missing"
      : existsInBootstrap
        ? "resolved"
        : resolution.id === route.categoryId ? resolution.status : "loading";
  const resolvedCategories = route.categoryRequested
    && route.categoryId !== null
    && resolution.id === route.categoryId
    && resolution.status === "resolved"
    ? resolution.categories
    : emptyCategories;
  const categories = useMemo(() => {
    if (!resolvedCategories.length) return bootstrapCategories;
    const byId = new Map(bootstrapCategories.map((category) => [category.id, category]));
    resolvedCategories.forEach((category) => byId.set(category.id, category));
    return [...byId.values()];
  }, [bootstrapCategories, resolvedCategories]);

  return {
    status,
    categoryId: status === "resolved" ? route.categoryId : null,
    categories,
    retry: () => setRetryToken((value) => value + 1),
  };
}
