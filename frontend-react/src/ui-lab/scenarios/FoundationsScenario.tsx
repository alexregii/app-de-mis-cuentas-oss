import {useState} from "react";
import {MoneyAmount} from "../../ui/finance/MoneyAmount";
import {LabSection} from "../components/LabSection";
import {foundationRules, foundationTokens} from "../fixtures/foundations";

export function FoundationsScenario() {
  const [privateAmounts, setPrivateAmounts] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

  return (
    <LabSection title="Foundations" detail="Contrato estable compartido por producción y UI Lab.">
      <ul className="ui-lab-token-list" aria-label="Tokens compartidos demostrados">
        {foundationTokens.map((token) => (
          <li key={token.name}>
            <span>{token.name}</span>
            <strong>{token.value}</strong>
            <span>{token.description}</span>
          </li>
        ))}
      </ul>
      <div className="ui-foundation-controls" aria-label="Estados de prueba">
        <button type="button" aria-pressed={privateAmounts} onClick={() => setPrivateAmounts((current) => !current)}>{privateAmounts ? "Mostrar importes" : "Ocultar importes"}</button>
        <button type="button" aria-pressed={overlayVisible} onClick={() => setOverlayVisible((current) => !current)}>{overlayVisible ? "Ocultar overlay" : "Mostrar overlay"}</button>
      </div>
      <div className={`ui-foundation-board${overlayVisible ? " has-overlay" : ""}`}>
        <div className="ui-foundation-readout">
          <span className="ui-foundation-label">Saldo confirmado</span>
          <div className="ui-foundation-money">
            <MoneyAmount value={4882.66} privateAmounts={privateAmounts} label="Saldo" />
            <span>Cuenta principal · conciliada</span>
          </div>
        </div>
        <div className="ui-foundation-rules">
          <dl>
            {foundationRules.map((rule) => <div key={rule.term}><dt>{rule.term}</dt><dd>{rule.detail}</dd></div>)}
          </dl>
        </div>
        {overlayVisible ? <aside className="ui-foundation-overlay" aria-live="polite"><strong>Overlay funcional</strong><p>Una capa flotante reserva la elevación para decisiones o navegación temporal.</p></aside> : null}
      </div>
      <p className="ui-lab-note">Las foundations se prueban aquí con datos sintéticos antes de crear o migrar un componente de dominio.</p>
    </LabSection>
  );
}
