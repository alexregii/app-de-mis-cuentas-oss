import {useState} from "react";
import {Search, Trash2} from "lucide-react";
import {Button, ButtonLink, IconButton, TextButton, TextLink} from "../../ui/controls/Button";
import {FormField, Input, Select} from "../../ui/controls/FormField";
import {SegmentedControl, SegmentedItem} from "../../ui/controls/SegmentedControl";
import {LabSection} from "../components/LabSection";

export function ControlsScenario() {
  const [segment, setSegment] = useState<"all" | "attention" | "prepared">("all");
  return (
    <LabSection title="Controls" detail="Controles estables consumidos por UI Lab y produccion.">
      <div className="ui-lab-control-grid" aria-label="Variantes de Button">
        <Button>Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="primary">Primary</Button>
        <Button variant="danger">Danger</Button>
        <Button disabled>Disabled</Button>
        <Button loading loadingLabel="Guardando…">Guardar</Button>
      </div>
      <div className="ui-lab-control-grid" aria-label="Variantes de IconButton">
        <IconButton aria-label="Buscar"><Search aria-hidden="true" /></IconButton>
        <IconButton aria-label="Buscar destacado" variant="primary"><Search aria-hidden="true" /></IconButton>
        <IconButton aria-label="Eliminar" variant="subtle"><Trash2 aria-hidden="true" /></IconButton>
      </div>
      <div className="ui-lab-control-grid" aria-label="Acciones enlazadas y de texto">
        <ButtonLink href="#controls" variant="secondary">Enlace como botón</ButtonLink>
        <TextButton>Acción de texto</TextButton>
        <TextLink href="#controls">Enlace de texto</TextLink>
      </div>
      <div className="ui-lab-control-grid" aria-label="SegmentedControl">
        <SegmentedControl aria-label="Filtrar ejemplo">
          <SegmentedItem selected={segment === "all"} onClick={() => setSegment("all")}>Todos</SegmentedItem>
          <SegmentedItem selected={segment === "attention"} onClick={() => setSegment("attention")}>Atención</SegmentedItem>
          <SegmentedItem selected={segment === "prepared"} onClick={() => setSegment("prepared")}>Preparados</SegmentedItem>
        </SegmentedControl>
      </div>
      <div className="ui-lab-field-grid" aria-label="Campos estables">
        <FormField label="Nombre"><Input defaultValue="Cuenta diaria" /></FormField>
        <FormField label="Tipo"><Select defaultValue="expense"><option value="expense">Gasto</option><option value="income">Ingreso</option></Select></FormField>
        <FormField label="Importe" hint="EUR" error={<small className="field-error" role="alert">Introduce un importe válido.</small>}><Input type="number" aria-invalid="true" defaultValue="0" /></FormField>
      </div>
      <p className="ui-lab-note">Las features eligen intencion y contenido; color, geometria, estados y motion pertenecen al control estable.</p>
    </LabSection>
  );
}
