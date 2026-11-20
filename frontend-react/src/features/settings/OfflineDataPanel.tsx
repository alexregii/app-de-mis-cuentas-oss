import {useState} from "react";
import {HardDriveDownload, Trash2} from "lucide-react";
import {clearOfflineData} from "../../shared/api/client";
import {ConfirmDialog} from "../../shared/components/ConfirmDialog";
import {SectionHeader} from "../../shared/components/ui";
import {Button} from "../../ui/controls/Button";

export function OfflineDataPanel({setStatus}: {setStatus: (message: string) => void}) {
  const [clearing, setClearing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  return (
    <section className="settings-offline-data">
      <SectionHeader title="Datos sin conexión" detail="El dispositivo guarda lecturas recientes para poder consultarlas sin red." />
      <div className="stack-list">
        <p>Al borrarlos se eliminan las copias locales y los recursos guardados de la aplicación. Conserva tus preferencias y no borra cuentas, movimientos ni ajustes del servidor.</p>
        <div className="inline-actions">
          <Button
            variant="secondary"
            disabled={clearing}
            onClick={(event) => {event.currentTarget.focus({preventScroll: true}); setConfirmingClear(true);}}
          >
            {clearing ? <HardDriveDownload aria-hidden="true" className="spin" /> : <Trash2 aria-hidden="true" />}
            {clearing ? "Borrando datos…" : "Borrar datos sin conexión"}
          </Button>
        </div>
      </div>
      {confirmingClear ? (
        <ConfirmDialog
          title="¿Borrar datos sin conexión?"
          description="Se eliminarán de este dispositivo las copias locales y recursos guardados. Tus preferencias, cuentas, movimientos y ajustes del servidor no cambiarán."
          confirmLabel="Borrar datos"
          onCancel={() => setConfirmingClear(false)}
          onConfirm={async () => {
            setClearing(true);
            try {
              await clearOfflineData();
              setStatus("Datos sin conexión eliminados de este dispositivo. El servidor no se ha modificado.");
            } catch {
              setStatus("No se pudieron borrar los datos sin conexión. Inténtalo otra vez.");
            } finally {
              setClearing(false);
            }
          }}
        />
      ) : null}
    </section>
  );
}
