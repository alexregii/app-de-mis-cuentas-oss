import {Button} from "../../ui/controls/Button";
import {ErrorBanner, StatusBanner} from "../../shared/components/ui";
import type {PreparedBudgetIssue} from "./usePreparedBudgetRoute";

export function PreparedBudgetRecovery({
  issue,
  pending = false,
  onChooseManually,
  onReviewCategory,
  onRetry,
}: {
  issue: PreparedBudgetIssue | null;
  pending?: boolean;
  onChooseManually: () => void;
  onReviewCategory: () => void;
  onRetry: () => void;
}) {
  if (pending) return <StatusBanner message="Comprobando categoría y mes del presupuesto preparado…" />;
  if (!issue) return null;
  return (
    <div className="planning-prepared-budget-recovery">
      <ErrorBanner message={`${issue.message} No se ha guardado ni cambiado ningún presupuesto.`} />
      <div className="inline-actions">
        <Button variant="secondary" onClick={onChooseManually}>Elegir categoría y mes</Button>
        {issue.categoryId ? <Button variant="secondary" onClick={onReviewCategory}>Revisar categoría</Button> : null}
        {issue.retry ? <Button variant="secondary" onClick={onRetry}>Reintentar</Button> : null}
      </div>
    </div>
  );
}
