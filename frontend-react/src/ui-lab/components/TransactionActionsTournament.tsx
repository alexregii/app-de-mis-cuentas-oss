import {Archive, Pencil, RotateCcw} from "lucide-react";
import {useState} from "react";
import {OverflowMenu, OverflowMenuItem} from "../../ui/controls/OverflowMenu";
import {TransactionRow, type TransactionRowItem} from "../../ui/finance/TransactionRow";
import type {LedgerItemCapabilities} from "../../ui/finance/LedgerItem";

type Action = "edit" | "archive" | "reopen";
type Props = {items: TransactionRowItem[]; privateAmounts: boolean; onAction: (id: string, action: Action) => void};

const actionOptions: Array<{action: Action; label: string; icon: typeof Pencil}> = [
  {action: "edit", label: "Editar", icon: Pencil},
  {action: "archive", label: "Archivar", icon: Archive},
  {action: "reopen", label: "Reabrir", icon: RotateCcw},
];

function MenuStack({items, privateAmounts, onAction, enabledActions}: Props & {enabledActions: Action[]}) {
  return <div className="ui-lab-action-stack ui-lab-action-stack--menu">
    {items.map((item) => <div className="ui-lab-action-row" key={item.id}>
      <TransactionRow item={item} capabilities={{edit: false, archive: false, reopen: false} satisfies LedgerItemCapabilities} privateAmounts={privateAmounts} />
      {enabledActions.length ? <div className="ui-lab-action-row__menu"><OverflowMenu label={`Acciones para ${item.description}`} compact>{actionOptions.filter(({action}) => enabledActions.includes(action)).map(({action, label, icon: Icon}) => <OverflowMenuItem onClick={() => onAction(item.id, action)} key={action}><Icon aria-hidden="true" />{label}</OverflowMenuItem>)}</OverflowMenu></div> : null}
    </div>)}
  </div>;
}

export function TransactionActionsTournament({items, privateAmounts, onAction}: Props) {
  const [enabledActions, setEnabledActions] = useState<Action[]>(actionOptions.map(({action}) => action));
  const toggleAction = (action: Action) => setEnabledActions((current) => current.includes(action) ? current.filter((value) => value !== action) : [...current, action]);

  return <div className="ui-lab-tournament" aria-label="Candidato final de acciones de TransactionRow v2">
    <h3>Acciones de TransactionRow v2 · ganador</h3>
    <p>Menú mínimo con tres movimientos apilados. Activa o desactiva capacidades para comprobar el resultado final.</p>
    <div className="ui-foundation-controls ui-lab-action-toggles" aria-label="Acciones visibles en el candidato">
      {actionOptions.map(({action, label, icon: Icon}) => <button type="button" aria-pressed={enabledActions.includes(action)} onClick={() => toggleAction(action)} key={action}><Icon aria-hidden="true" />{label}</button>)}
    </div>
    {!enabledActions.length ? <p className="ui-lab-note" role="status">No hay acciones activas. Las filas permanecen completamente informativas.</p> : null}
    <section className="ui-lab-transaction-prototype">
      <h4>Menú mínimo</h4>
      <p>Un único control silencioso abre todas las capacidades activas; Archivar conserva el mismo tratamiento neutro que el resto.</p>
      <MenuStack items={items} privateAmounts={privateAmounts} onAction={onAction} enabledActions={enabledActions} />
    </section>
  </div>;
}
