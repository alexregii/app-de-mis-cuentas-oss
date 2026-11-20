import type {ReactNode, RefObject} from "react";

type LedgerArchetypeProps = {
  header?: ReactNode;
  selection?: ReactNode;
  filterSlot: ReactNode;
  results: ReactNode;
  pagination?: ReactNode;
  resultsRef?: RefObject<HTMLDivElement | null>;
  ariaLabel?: string;
};

/**
 * Stable visual composition for a financial ledger.
 *
 * Domain state, callbacks, and filter/selection policy stay with the consumer;
 * this component owns only the shared order and layout boundary.
 */
export function LedgerArchetype({
  header,
  selection,
  filterSlot,
  results,
  pagination,
  resultsRef,
  ariaLabel = "Arquetipo de ledger",
}: LedgerArchetypeProps) {
  return <section className="ui-ledger-archetype" data-ledger-archetype aria-label={ariaLabel}>
    {header ? <div className="ui-ledger-archetype__slot" data-ledger-slot="header">{header}</div> : null}
    {selection ? <div className="ui-ledger-archetype__slot" data-ledger-slot="selection">{selection}</div> : null}
    <div className="ui-ledger-archetype__slot" data-ledger-slot="filter">{filterSlot}</div>
    <div ref={resultsRef} className="ui-ledger-archetype__results" data-ledger-slot="results" tabIndex={-1} role="region" aria-label="Resultados del ledger">
      {results}
      {pagination}
    </div>
  </section>;
}
