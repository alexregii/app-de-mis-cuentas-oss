import {useState} from "react";
import {TransactionRow} from "../../ui/finance/TransactionRow";
import {LabSection} from "../components/LabSection";
import {TransactionActionsTournament} from "../components/TransactionActionsTournament";
import {transactionCapabilities, transactionDirections, transactionFixtures} from "../fixtures/transactions";

export function TransactionRowScenario() {
  const [compact, setCompact] = useState(false);
  const [privateAmounts, setPrivateAmounts] = useState(false);
  const [selectable, setSelectable] = useState(true);
  const [selected, setSelected] = useState<string[]>(["expense"]);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const actionLabel = lastAction?.startsWith("edit") ? "Editar" : lastAction?.startsWith("archive") ? "Archivar" : lastAction?.startsWith("reopen") ? "Reabrir" : "Abrir adjuntos";
  const toggleSelection = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return (
    <LabSection title="TransactionRow v2" detail="Dirección elegida: ledger columnar. El importe y la descripción dominan; el contexto no compite.">
      <div className="ui-lab-direction-list" aria-label="Direcciones evaluadas">
        {transactionDirections.map((direction) => <p key={direction.name}><strong>{direction.name}</strong><span>{direction.detail}</span></p>)}
      </div>
      <div className="ui-foundation-controls" aria-label="Estados de prueba de TransactionRow">
        <button type="button" aria-pressed={compact} onClick={() => setCompact((current) => !current)}>{compact ? "Ver completa" : "Ver compacta"}</button>
        <button type="button" aria-pressed={selectable} onClick={() => setSelectable((current) => !current)}>{selectable ? "Ocultar selección" : "Mostrar selección"}</button>
        <button type="button" aria-pressed={privateAmounts} onClick={() => setPrivateAmounts((current) => !current)}>{privateAmounts ? "Mostrar importes" : "Ocultar importes"}</button>
      </div>
      <div className="ui-transaction-list" aria-label="Movimientos de prueba">
        {transactionFixtures.map((item) => <TransactionRow key={item.id} item={item} capabilities={transactionCapabilities[item.id as keyof typeof transactionCapabilities]} compact={compact} privateAmounts={privateAmounts} selected={selectable && selected.includes(item.id)} onSelect={selectable ? toggleSelection : undefined} onAction={(id, action) => setLastAction(`${action}:${id}`)} />)}
      </div>
      {lastAction ? <p className="ui-lab-note" role="status">Se probaría «{actionLabel}» en su flujo real, sin modificar datos desde el Lab.</p> : null}
      <TransactionActionsTournament items={transactionFixtures.slice(1, 4)} privateAmounts={privateAmounts} onAction={(id, action) => setLastAction(`${action}:${id}`)} />
    </LabSection>
  );
}
