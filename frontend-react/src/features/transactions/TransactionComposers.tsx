import {useLayoutEffect, useRef} from "react";
import {ArrowLeftRight, Plus, X} from "lucide-react";
import {Panel, SectionHeader} from "../../shared/components/ui";
import type {OptionsPayload} from "../../shared/model/bootstrap";
import type {Account} from "../../shared/model/accounts";
import type {Category} from "../../shared/model/categories";
import type {Transaction} from "../../shared/model/transactions";
import type {TransactionInput, TransferInput} from "./types";
import {TransactionForm} from "./TransactionForm";
import {TransactionAllocationForm, type AllocationPayload} from "./TransactionAllocationEditor";
import {TransferForm} from "./TransferForm";
import {emptyTransaction, transactionToInput} from "./transactionModel";
import {Button} from "../../ui/controls/Button";

export function TransactionComposers({
  options,
  accounts,
  categories,
  editing,
  allocationEditing,
  allocationSessionId,
  showManual,
  showTransfer,
  formErrors,
  transferErrors,
  onToggleManual,
  onToggleTransfer,
  onCloseAllocation,
  onSaveAllocations,
  onSubmitTransaction,
  onSubmitTransfer,
}: {
  options: OptionsPayload;
  accounts: Account[];
  categories: Category[];
  editing: Transaction | null;
  allocationEditing: Transaction | null;
  allocationSessionId: number;
  showManual: boolean;
  showTransfer: boolean;
  formErrors?: Record<string, string[]>;
  transferErrors?: Record<string, string[]>;
  onToggleManual: () => void;
  onToggleTransfer: () => void;
  onCloseAllocation: () => void;
  onSaveAllocations: (movement: Transaction, allocations: AllocationPayload, expectedRevision: number) => Promise<void>;
  onSubmitTransaction: (input: TransactionInput & {attachment?: File | null}) => Promise<void>;
  onSubmitTransfer: (input: TransferInput) => Promise<void>;
}) {
  const transferNavRef = useRef<HTMLElement>(null);
  const previousShowTransferRef = useRef(showTransfer);
  useLayoutEffect(() => {
    const closingTransfer = previousShowTransferRef.current && !showTransfer && !showManual;
    previousShowTransferRef.current = showTransfer;
    if (closingTransfer) transferNavRef.current?.querySelector<HTMLButtonElement>("[data-transfer-trigger]")?.focus({preventScroll: true});
  }, [showManual, showTransfer]);

  if (!showManual && !showTransfer && !allocationEditing) {
    return (
      <nav ref={transferNavRef} className="transaction-composer-actions" aria-label="Acciones de movimientos">
        <Button data-transfer-trigger variant="secondary" onClick={onToggleTransfer}>
          <ArrowLeftRight aria-hidden="true" /> Registrar traspaso
        </Button>
        <p>Los traspasos no afectan a ingresos ni gastos.</p>
      </nav>
    );
  }

  return (
    <div className="transaction-composer-open">
      {allocationEditing ? <Panel className="composer-panel">
        <SectionHeader
          title="Distribuir categorías"
          action={<Button variant="secondary" onClick={onCloseAllocation}><X aria-hidden="true" />Cerrar</Button>}
        />
        <TransactionAllocationForm
          key={`${allocationSessionId}:${allocationEditing.id}`}
          movement={allocationEditing}
          categories={categories}
          linkedRefund={Boolean(allocationEditing.refund_for_id)}
          onSave={(allocations, expectedRevision) => onSaveAllocations(allocationEditing, allocations, expectedRevision)}
          onCancel={onCloseAllocation}
        />
      </Panel> : null}

      {showManual ? <Panel className="composer-panel">
        <SectionHeader
          title={editing ? "Editar movimiento" : "Movimiento manual"}
          action={
            <Button variant="secondary" onClick={onToggleManual}>
              {showManual ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
              {showManual ? "Cerrar" : "Nuevo"}
            </Button>
          }
        />
        {showManual ? (
          <TransactionForm
            key={editing?.id ?? "manual-create"}
            title={editing ? "Editar movimiento" : "Añadir ingreso o gasto"}
            submitLabel={editing ? "Guardar cambios" : "Guardar movimiento"}
            accounts={accounts}
            categories={categories}
            refundCandidates={options.refund_candidates}
            initial={editing ? transactionToInput(editing) : {...emptyTransaction, account: String(accounts[0]?.id || "")}}
            errors={formErrors}
            onSubmit={onSubmitTransaction}
          />
        ) : (
          <div className="quick-entry">
            <Plus aria-hidden="true" />
            <span>Alta manual rápida para ingresos y gastos con reembolsos, etiquetas y notas.</span>
          </div>
        )}
      </Panel> : null}

      {showTransfer ? <Panel className="composer-panel">
        <SectionHeader
          title="Traspasos"
          action={
            <Button variant="secondary" onClick={onToggleTransfer}>
              {showTransfer ? <X aria-hidden="true" /> : <ArrowLeftRight aria-hidden="true" />}
              {showTransfer ? "Cerrar" : "Nuevo"}
            </Button>
          }
        />
        {showTransfer ? (
          <TransferForm
            accounts={accounts}
            errors={transferErrors}
            onSubmit={onSubmitTransfer}
          />
        ) : (
          <div className="quick-entry">
            <ArrowLeftRight aria-hidden="true" />
            <span>Los traspasos crean dos movimientos enlazados y no afectan a ingresos ni gastos.</span>
          </div>
        )}
      </Panel> : null}
    </div>
  );
}
