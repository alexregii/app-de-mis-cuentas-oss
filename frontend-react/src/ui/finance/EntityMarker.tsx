import type {CSSProperties} from "react";
import type {LedgerEntity} from "./LedgerItem";

export function EntityMarker({entity, kind = "account"}: {entity: LedgerEntity; kind?: "account" | "category"}) {
  return <span className={`ui-entity-marker ui-entity-marker--${kind}`}>
    <i aria-hidden="true" style={{"--entity-color": entity.color} as CSSProperties} />
    <span>{entity.name}</span>
  </span>;
}
