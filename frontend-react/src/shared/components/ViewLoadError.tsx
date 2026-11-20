import {RefreshCw} from "lucide-react";
import {Button} from "../../ui/controls/Button";
import {PageHeader} from "../../ui/layout/PageHeader";
import {ErrorBanner, Panel} from "./ui";

export function ViewLoadError({title, message, onRetry}: {title: string; message: string; onRetry: () => void}) {
  return (
    <div className="view-stack">
      <PageHeader title={title} />
      <ErrorBanner message={message} />
      <Panel className="load-error-panel">
        <p>No se han podido cargar los datos de esta sección.</p>
        <Button variant="primary" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Reintentar
        </Button>
      </Panel>
    </div>
  );
}
