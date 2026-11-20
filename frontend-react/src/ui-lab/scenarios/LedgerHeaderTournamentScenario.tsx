import {useState} from "react";
import {LedgerHeader, headerCandidates, type HeaderCandidate} from "../components/LedgerHeader";
import {LabSection} from "../components/LabSection";

export function LedgerHeaderTournamentScenario() {
  const [candidate, setCandidate] = useState<HeaderCandidate>("statement");
  const [privateAmounts, setPrivateAmounts] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);

  return <LabSection title="Ledger header tournament" detail="Comparación aislada de seis lecturas para la cabecera; no modifica el Ledger archetype consolidado.">
    <div className="ui-lab-header-tournament" aria-label="Experimento de cabeceras del ledger">
      <div className="ui-lab-statement__header-tournament"><label htmlFor="ledger-header-candidate">Comparar cabecera</label><select id="ledger-header-candidate" value={candidate} onChange={(event) => setCandidate(event.target.value as HeaderCandidate)}>{headerCandidates.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></div>
      <LedgerHeader candidate={candidate} privateAmounts={privateAmounts} selectionMode={selectionMode} onTogglePrivate={() => setPrivateAmounts((current) => !current)} onToggleSelection={() => setSelectionMode((current) => !current)} />
    </div>
  </LabSection>;
}
