import {Paperclip} from "lucide-react";

export function TransactionMetadata({
  sourceLabel,
  isRefund = false,
  isTransfer = false,
  transferFrom,
  transferTo,
  attachmentCount = 0,
  contextDetail,
}: {
  sourceLabel?: string;
  isRefund?: boolean;
  isTransfer?: boolean;
  transferFrom?: string;
  transferTo?: string;
  attachmentCount?: number;
  contextDetail?: string;
}) {
  const labels = [
    sourceLabel ? {label: sourceLabel} : null,
    isTransfer ? {label: transferFrom && transferTo ? `Transferencia · ${transferFrom} → ${transferTo}` : "Transferencia"} : null,
    isRefund ? {label: "Reembolso"} : null,
    attachmentCount ? {label: `${attachmentCount} adjunto${attachmentCount > 1 ? "s" : ""}`, icon: true} : null,
    contextDetail ? {label: contextDetail} : null,
  ].filter((label): label is {label: string; icon?: boolean} => Boolean(label));

  if (!labels.length) return null;
  const text = labels.map((item) => item.label).join(" · ");
  return <span className="ui-transaction-metadata">{labels.some((item) => item.icon) ? <Paperclip aria-hidden="true" /> : null}{text}</span>;
}
