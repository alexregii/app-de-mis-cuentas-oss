import {useEffect, useMemo, useRef, useState} from "react";
import {displayEuro} from "../../format";
import {Button} from "../../ui/controls/Button";
import {FormField, Select} from "../../ui/controls/FormField";
import type {BankTransferLinkPayload} from "./adapters/reviewAdapterTypes";
import {reviewApi} from "./api";
import type {BankReviewRow, BankTransferCandidate} from "./types";

type Props = {
  origin: BankReviewRow;
  privateAmounts: boolean;
  onConfirm: (input: BankTransferLinkPayload) => Promise<boolean>;
  onCancel: () => void;
};

export function UnlinkedTransferRows({rows, activeId, privateAmounts, onLink}: {rows: readonly BankReviewRow[]; activeId: number | null; privateAmounts: boolean; onLink: (id: number) => void}) {
  if (!rows.length) return null;
  return <section className="bank-transfer-unlinked" aria-label="Traspasos omitidos sin enlazar">
    <h3>Traspasos omitidos sin enlazar</h3>
    <p>Estas filas tienen una señal de posible traspaso; todavía no se han contabilizado en el libro.</p>
    <div className="bank-transfer-unlinked__list">
      {rows.map((row) => <div className="bank-transfer-unlinked__row" key={row.id}>
        <div className="bank-transfer-unlinked__copy">
          <strong>{row.bank_account.account.name}</strong>
          <span>{row.booking_date} · {row.description} · {displayEuro(row.amount, privateAmounts)}</span>
        </div>
        <Button id={`bank-transfer-open-${row.id}`} data-bank-transfer-open variant="secondary" aria-expanded={activeId === row.id} aria-controls={activeId === row.id ? `bank-transfer-link-panel-${row.id}` : undefined} onClick={() => onLink(row.id)}>Revisar traspaso</Button>
      </div>)}
    </div>
  </section>;
}

const candidateKey = (candidate: BankTransferCandidate) => `${candidate.candidate_type}:${candidate.candidate_id}`;

export function BankTransferLinkPanel({origin, privateAmounts, onConfirm, onCancel}: Props) {
  const [candidates, setCandidates] = useState<BankTransferCandidate[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [confirmFee, setConfirmFee] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryToken, setRetryToken] = useState(0);
  const busyRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    return () => {if (generationRef.current === generation) generationRef.current += 1;};
  }, [origin.id]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setCandidates([]);
    setSelectedKey("");
    reviewApi.bankTransferOptions(origin.id)
      .then(({candidates: next}) => {
        if (!active) return;
        setCandidates(next);
        setSelectedKey(next.length === 1 ? candidateKey(next[0]) : "");
        setConfirmFee(false);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "No se pudieron buscar contrapartidas.");
      })
      .finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [origin.id, retryToken]);

  useEffect(() => {
    if (privateAmounts) setConfirmFee(false);
  }, [privateAmounts]);

  const selected = useMemo(() => candidates.find((candidate) => candidateKey(candidate) === selectedKey), [candidates, selectedKey]);
  const transferDescription = (candidate: BankTransferCandidate) => candidate.candidate_type === "bank_row"
    ? "Se enlazarán los dos apuntes bancarios y se crearán las piernas del traspaso."
    : "Se enlazará esta fila al par de traspaso existente; el par no se duplicará.";
  const cancel = () => {
    generationRef.current += 1;
    onCancel();
  };

  const confirm = async () => {
    if (!selected || busyRef.current) return;
    if (selected.requires_fee_confirmation && (privateAmounts || !confirmFee)) {
      setError(privateAmounts ? "Muestra los importes para confirmar la comisión." : "Confirma la diferencia como comisión o cancela el enlace.");
      return;
    }
    const generation = generationRef.current;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const completed = await onConfirm({
        candidate_type: selected.candidate_type,
        candidate_id: selected.candidate_id,
        confirm_fee: confirmFee,
      });
      if (generationRef.current !== generation) return;
      if (completed) cancel();
      else setError("No se pudo enlazar el traspaso. Revisa el estado y vuelve a intentarlo.");
    } catch (reason) {
      if (generationRef.current === generation) setError(reason instanceof Error ? reason.message : "No se pudo enlazar el traspaso. Vuelve a intentarlo.");
    } finally {
      busyRef.current = false;
      if (generationRef.current === generation) setBusy(false);
    }
  };

  return <section id={`bank-transfer-link-panel-${origin.id}`} className="bank-transfer-link-panel" role="region" aria-label="Preview y enlace de traspaso">
    <h3>Enlazar traspaso</h3>
    <p>Origen seleccionado: {origin.bank_account.account.name} · {origin.booking_date} · {origin.description} · {displayEuro(origin.amount, privateAmounts)}</p>
    {loading ? <span role="status">Buscando contrapartidas…</span> : null}
    {!loading && !error && !candidates.length ? <p>No hay una contrapartida compatible en otra cuenta dentro de siete días. La fila permanece sin contabilizar.</p> : null}
    {!loading && candidates.length ? <FormField label="Contrapartida" className="compact-label">
      <Select value={selectedKey} onChange={(event) => {setSelectedKey(event.target.value); setConfirmFee(false);}}>
        <option value="">Selecciona una fila o un par existente</option>
        {candidates.map((candidate) => <option key={candidateKey(candidate)} value={candidateKey(candidate)}>
          {candidate.source === "existing_pair" ? "Par existente" : candidate.incoming.account.id === origin.bank_account.account.id ? "Entrada bancaria" : "Salida bancaria"} · {candidate.outgoing.booking_date} → {candidate.incoming.booking_date} · {candidate.outgoing.account.name} → {candidate.incoming.account.name} · {displayEuro(candidate.transfer_amount, privateAmounts)}
        </option>)}
      </Select>
    </FormField> : null}
    {selected ? <div className="bank-transfer-link-panel__preview" aria-live="polite">
      <p><strong>Sale de {selected.outgoing.account.name}:</strong> {selected.outgoing.booking_date} · {selected.outgoing.description} · {displayEuro(selected.outgoing.amount, privateAmounts)}</p>
      <p><strong>Entra en {selected.incoming.account.name}:</strong> {selected.incoming.booking_date} · {selected.incoming.description} · {displayEuro(selected.incoming.amount, privateAmounts)}</p>
      <p>{transferDescription(selected)}</p>
      {selected.requires_fee_confirmation && privateAmounts ? <p>Muestra los importes para confirmar la comisión.</p> : null}
      {selected.requires_fee_confirmation && !privateAmounts ? <label className="check-row">
        <input type="checkbox" checked={confirmFee} onChange={(event) => setConfirmFee(event.target.checked)} />
        Confirmo que {displayEuro(selected.fee_amount, privateAmounts)} es una comisión bancaria de la salida.
      </label> : null}
    </div> : null}
    {error ? <p role="alert" className="bank-transfer-link-panel__error">{error}</p> : null}
    <div className="inline-actions">
      {error && !loading && !candidates.length ? <Button variant="secondary" onClick={() => setRetryToken((token) => token + 1)}>Reintentar búsqueda</Button> : null}
      <Button variant="secondary" onClick={cancel}>Cancelar</Button>
      {selected ? <Button
        variant="primary"
        aria-disabled={busy || selected.requires_fee_confirmation && (privateAmounts || !confirmFee) || undefined}
        aria-busy={busy || undefined}
        onClick={() => {void confirm();}}
      >{busy ? "Enlazando…" : selected.requires_fee_confirmation ? "Confirmar traspaso y comisión" : "Confirmar traspaso"}</Button> : null}
    </div>
  </section>;
}
