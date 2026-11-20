import {CalendarRange, Plus} from "lucide-react";
import {Button} from "../../ui/controls/Button";
import {PageHeader} from "../../ui/layout/PageHeader";
import {LabSection} from "../components/LabSection";

export function PageHeaderScenario() {
  return (
    <LabSection title="Page header" detail="Jerarquia de pagina compacta para vistas operativas y formularios densos.">
      <div className="ui-lab-page-header-stack">
        <PageHeader
          title="Movimientos"
          description="Consulta, filtra y registra movimientos."
          actions={<Button variant="primary"><Plus aria-hidden="true" /> Añadir</Button>}
        />
        <PageHeader
          title="Plan"
          actions={<Button variant="secondary"><CalendarRange aria-hidden="true" /> Septiembre 2026</Button>}
        />
        <PageHeader title="Estadísticas" />
      </div>
      <p className="ui-lab-note">La cabecera evita hero typography y decoración de landing page: prioriza orientación, contexto y acciones de trabajo.</p>
    </LabSection>
  );
}
