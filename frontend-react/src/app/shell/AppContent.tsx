import {useLayoutEffect, useState, type MouseEvent} from "react";
import {motion, type HTMLMotionProps} from "motion/react";
import {RefreshCw, ShieldCheck} from "lucide-react";
import {PullToRefresh} from "../../shared/components/PullToRefresh";
import {ErrorBanner, LoadingPanel, Panel} from "../../shared/components/ui";
import {errorMessage} from "../../shared/lib/errors";
import type {AppBootstrapState, SectionDefinition, SectionRuntime} from "../contracts";
import type {Tab} from "../contracts";
import {sectionById} from "../sections";
import {isTransactionIntentHref} from "../../shared/lib/transactionIntent";

const cacheableTabs: readonly Tab[] = ["transactions", "review", "statistics", "planning"];

export function AppContent({bootstrapState, section, runtime, pageMotion, preloadedTabs, clearError, reportError, clearRefreshError, reportRefreshError, onTransactionIntent}: {
  bootstrapState: AppBootstrapState;
  section: SectionDefinition;
  runtime: SectionRuntime | null;
  pageMotion: Pick<HTMLMotionProps<"div">, "initial" | "animate" | "exit" | "transition">;
  preloadedTabs: readonly Tab[];
  clearError: () => void;
  reportError: (message: string) => void;
  clearRefreshError: () => void;
  reportRefreshError: (message: string) => void;
  onTransactionIntent: (href: string) => void;
}) {
  const [visitedTabs, setVisitedTabs] = useState<ReadonlySet<Tab>>(() => new Set([section.id]));
  useLayoutEffect(() => {
    setVisitedTabs((current) => {
      if (current.has(section.id)) return current;
      return new Set([...current, section.id]);
    });
  }, [section.id]);
  const {bootstrap, error, reload} = bootstrapState;
  const handleTransactionIntent = (event: MouseEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link || link.target || link.hasAttribute("download") || !isTransactionIntentHref(link.href)) return;
    event.preventDefault();
    onTransactionIntent(link.href);
  };
  const cachedTabs = new Set([...preloadedTabs, ...visitedTabs, section.id].filter((tab) => cacheableTabs.includes(tab)));
  const activeSectionIsCached = cachedTabs.has(section.id);
  const refresh = async (): Promise<void> => {
    clearRefreshError();
    try {
      await reload();
      clearError();
    } catch (reason) {
      const message = errorMessage(reason, "No se pudo actualizar la aplicación.");
      if (!bootstrap) reportError(message);
      else reportRefreshError(message);
    }
  };
  return (
    <main id="main-content" className="app-shell" tabIndex={-1} onClickCapture={handleTransactionIntent}>
      {error && !bootstrap ? <ErrorBanner message={error} /> : null}
      {!bootstrap ? (
        error ? (
          <Panel className="offline-empty">
            <ShieldCheck aria-hidden="true" />
            <h2>{navigator.onLine ? "No se pudo cargar la aplicación" : "Sin conexión y sin datos recientes"}</h2>
            <p>{navigator.onLine ? "Comprueba que el servidor está disponible y vuelve a intentarlo." : "Abre la app una vez con conexión para guardar resumen, cuentas, movimientos y estadísticas en este dispositivo."}</p>
            <button className="button primary" type="button" onClick={() => {clearError(); reload().catch((reason) => reportError(errorMessage(reason, "No se pudo cargar la app React.")));}}>
              <RefreshCw aria-hidden="true" />
              Reintentar
            </button>
          </Panel>
        ) : <LoadingPanel label="Cargando la aplicación…" />
      ) : null}
      <PullToRefresh onRefresh={refresh}>
        {runtime && cachedTabs.size ? (
          <div className="database-screen-cache">
            {cacheableTabs.filter((tab) => cachedTabs.has(tab)).map((tab) => {
              const cachedSection = sectionById(tab);
              const hidden = tab !== section.id;
              return (
                <motion.div
                  key={tab}
                  className={`motion-page${hidden ? " database-screen-cache__inactive" : ""}`}
                  data-cached-tab={tab}
                  aria-hidden={hidden}
                  inert={hidden}
                  initial={pageMotion.initial}
                  animate={hidden ? pageMotion.initial : pageMotion.animate}
                  transition={pageMotion.transition}
                >
                  {cachedSection.render(runtime)}
                </motion.div>
              );
            })}
          </div>
        ) : null}
        {runtime && !activeSectionIsCached ? (
          <motion.div key={section.id} className="motion-page" {...pageMotion}>
            {section.render(runtime)}
          </motion.div>
        ) : null}
      </PullToRefresh>
    </main>
  );
}
