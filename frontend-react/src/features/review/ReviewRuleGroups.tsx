import {useRef, useState} from "react";
import {displayEuro, formatDate} from "../../format";
import {Button} from "../../ui/controls/Button";
import type {PreparedReview} from "./adapters/reviewAdapterTypes";
import type {ReviewRuleConflict, ReviewRuleGroup} from "./reviewRuleModel";

function kindLabel(kind: PreparedReview["draft"]["kind"]) {
  return kind === "income" ? "ingresos" : kind === "expense" ? "gastos" : "traspasos";
}

export function ReviewRuleGroups({groups, conflicts, privateAmounts = false, focusTargetId, onApply}: {
  groups: readonly ReviewRuleGroup[];
  conflicts: readonly ReviewRuleConflict[];
  privateAmounts?: boolean;
  focusTargetId: string;
  onApply: (group: ReviewRuleGroup, rows: readonly PreparedReview[]) => Promise<boolean>;
}) {
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [excludedByGroup, setExcludedByGroup] = useState<Record<string, number[]>>({});
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const busyRef = useRef(false);
  const applyGroup = async (group: ReviewRuleGroup) => {
    const excluded = new Set(excludedByGroup[group.id] || []);
    const rows = group.rows.filter((row) => !excluded.has(row.sourceId));
    if (!rows.length || busyRef.current) return;
    busyRef.current = true;
    setBusyGroupId(group.id);
    const previewId = `${focusTargetId}-rule-${group.source}-${group.rule.id}-${group.batchId ?? "bank"}-${group.accountId}-${group.kind}-preview`;
    try {
      const applied = await onApply(group, rows);
      if (applied) {
        setOpenGroupId(null);
        setExcludedByGroup((current) => ({...current, [group.id]: []}));
        requestAnimationFrame(() => document.getElementById(focusTargetId)?.focus({preventScroll: true}));
      } else {
        requestAnimationFrame(() => {
          const active = document.activeElement;
          if (active && active !== document.body && active.isConnected) return;
          const preview = document.getElementById(previewId);
          const nextAction = preview?.querySelector<HTMLElement>(".review-rule-groups__actions button");
          const trigger = document.querySelector<HTMLElement>(`[aria-controls="${previewId}"]`);
          (nextAction ?? trigger ?? document.getElementById(focusTargetId))?.focus({preventScroll: true});
        });
      }
    } finally {
      busyRef.current = false;
      setBusyGroupId(null);
    }
  };

  return <section className="review-rule-groups" aria-labelledby={`${focusTargetId}-groups-title`}>
    <h3 id={`${focusTargetId}-groups-title`}>Grupos por regla</h3>
    <p className="review-rule-groups__note">La vista previa es solo lectura. No incorpora movimientos ni crea reglas hasta que confirmes el grupo.</p>
    {!groups.length && !conflicts.length ? <p className="review-rule-groups__empty">No hay grupos homogéneos listos. Las filas siguen disponibles para revisión individual.</p> : null}
    <ul className="review-rule-groups__list">
      {groups.map((group) => {
        const excluded = new Set(excludedByGroup[group.id] || []);
        const includedCount = group.rows.filter((row) => !excluded.has(row.sourceId)).length;
        const expanded = openGroupId === group.id;
        const previewId = `${focusTargetId}-rule-${group.source}-${group.rule.id}-${group.batchId ?? "bank"}-${group.accountId}-${group.kind}-preview`;
        const accountName = group.rows[0]?.item.account?.name ?? "Cuenta seleccionada";
        return <li className="review-rule-groups__item" key={group.id}>
          <button
            type="button"
            className="review-rule-groups__trigger"
            aria-expanded={expanded}
            aria-controls={previewId}
            onClick={() => setOpenGroupId((current) => current === group.id ? null : group.id)}
          >
            <span><strong>Regla #{group.rule.id} · {group.rule.description}</strong><small>{group.rule.category.display_name} · {kindLabel(group.kind)} · {accountName} · {group.rows.length} filas</small></span>
            <span>{expanded ? "Cerrar vista previa" : "Revisar grupo"}</span>
          </button>
          {expanded ? <div className="review-rule-groups__preview" id={previewId} role="region" aria-label={`Vista previa de regla ${group.rule.description}`}>
            <p>Se enviarán estas filas con la categoría «{group.rule.category.display_name}». Quita del grupo cualquier fila que prefieras revisar por separado.</p>
            <ul className="review-rule-groups__rows">
              {group.rows.map((row) => {
                const included = !excluded.has(row.sourceId);
                return <li key={`${row.source}-${row.sourceId}`}>
                  <label><input
                    type="checkbox"
                    checked={included}
                    aria-label={`Incluir fila ${row.sourceId} en el grupo`}
                    aria-disabled={busyGroupId === group.id || undefined}
                    onChange={(event) => {
                      if (busyRef.current) return;
                      setExcludedByGroup((current) => {
                        const currentExcluded = current[group.id] || [];
                        const next = event.target.checked
                          ? currentExcluded.filter((id) => id !== row.sourceId)
                          : [...currentExcluded, row.sourceId];
                        return {...current, [group.id]: next};
                      });
                    }}
                  /> <strong>#{row.sourceId} · {row.item.description}</strong></label>
                  <span>{formatDate(row.item.date)} · {displayEuro(row.item.signedAmount, privateAmounts)}</span>
                </li>;
              })}
            </ul>
            <div className="review-rule-groups__actions">
              <span>{includedCount} de {group.rows.length} filas seleccionadas</span>
              <Button
                variant="primary"
                aria-disabled={busyGroupId === group.id || includedCount === 0}
                aria-busy={busyGroupId === group.id || undefined}
                onClick={() => {void applyGroup(group);}}
              >
                {busyGroupId === group.id ? "Incorporando…" : `Incorporar ${includedCount} filas`}
              </Button>
            </div>
          </div> : null}
        </li>;
      })}
    </ul>
    {conflicts.length ? <details className="review-rule-groups__conflicts">
      <summary>{conflicts.length} filas con reglas en conflicto o revisión individual</summary>
      <ul>{conflicts.map(({prepared, matches, reason}) => <li key={`${prepared.source}-${prepared.sourceId}`}>
        <strong>#{prepared.sourceId} · {prepared.item.description}</strong>
        <span>{reason}</span>
        {matches.length > 1 ? <small>{matches.map((rule) => `Regla #${rule.id} → ${rule.category.display_name}`).join(" · ")}</small> : null}
      </li>)}</ul>
      <p>Estas filas siguen en la cola individual y no se incorporarán desde un grupo.</p>
    </details> : null}
  </section>;
}
