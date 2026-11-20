import {compactEuro, euro} from "../../../format";
import {Panel, SectionHeader} from "../../../shared/components/ui";
import {toLedgerItem} from "../../../shared/adapters/transactionLedgerItem";
import {TransactionRow} from "../../../ui/finance/TransactionRow";
import type {DashboardWidgetDefinition} from "./widgetTypes";
import {TextButton} from "../../../ui/controls/Button";

const readOnlyLedgerCapabilities = {edit: false, archive: false, reopen: false} as const;

export const secondaryDashboardWidgets = {
  accounts: {
    id: "accounts",
    title: "Saldo por cuenta",
    region: "activity",
    modes: ["full", "balance"],
    hideable: true,
    reorderable: true,
    priority: 100,
    available: ({bootstrap}) => bootstrap.account_balances.length > 0,
    render: ({bootstrap, compact}) => {
      const density = compact ? " compact" : "";
      return (
        <Panel className={`dashboard-widget activity-accounts-widget${density}`}>
          <SectionHeader title="Saldo por cuenta" />
          <div className="account-balance-list">
            {bootstrap.account_balances.map((account) => (
              <div key={account.id}>
                <span
                  className="account-dot"
                  style={{background: account.color}}
                  aria-hidden="true"
                />
                <strong>{account.name}</strong>
                <b>{euro(account.balance)}</b>
              </div>
            ))}
          </div>
        </Panel>
      );
    },
  },
  category_rise: {
    id: "category_rise",
    title: "Categoría con mayor subida",
    region: "more",
    modes: ["full"],
    hideable: true,
    reorderable: true,
    priority: 110,
    available: ({bootstrap}) => Boolean(bootstrap.category_rise),
    render: ({bootstrap, compact, onStats}) => {
      if (!bootstrap.category_rise) return null;
      const density = compact ? " compact" : "";
      return (
        <Panel className={`dashboard-widget activity-recent-widget${density}`}>
          <SectionHeader
            title="Categoría con mayor subida"
            action={
              <TextButton onClick={onStats}>
                Ver estadísticas
              </TextButton>
            }
          />
          <div className="widget-line">
            <div>
              <strong>{bootstrap.category_rise.category}</strong>
              <span>{compactEuro(bootstrap.category_rise.current)} este mes</span>
            </div>
            <b className="negative">+{compactEuro(bootstrap.category_rise.difference)}</b>
          </div>
          <small>
            {bootstrap.category_rise.percent == null
              ? "Sin base comparable"
              : `+${bootstrap.category_rise.percent.toFixed(1)}% frente al mes anterior`}
          </small>
        </Panel>
      );
    },
  },
  recent: {
    id: "recent",
    title: "Últimos movimientos",
    region: "activity",
    modes: ["full"],
    hideable: true,
    reorderable: true,
    priority: 120,
    available: ({data}) => data.recent.length > 0,
    render: ({data, compact, privateAmounts, onOpenTransactions}) => {
      const density = compact ? " compact" : "";
      return (
        <Panel className={`dashboard-widget${density}`}>
          <SectionHeader
            title="Últimos movimientos"
            action={
              <TextButton onClick={onOpenTransactions}>
                Ver todos
              </TextButton>
            }
          />
          <div className="stack-list" data-dashboard-recent-transactions>
            {data.recent.slice(0, 5).map((movement) => (
              <TransactionRow
                key={movement.id}
                item={toLedgerItem(movement)}
                capabilities={readOnlyLedgerCapabilities}
                compact
                privateAmounts={privateAmounts}
              />
            ))}
          </div>
        </Panel>
      );
    },
  },
} satisfies Record<string, DashboardWidgetDefinition>;
