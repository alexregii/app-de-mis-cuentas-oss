import {motion, useReducedMotion} from "motion/react";
import {Pencil, Trash2} from "lucide-react";
import {MoneyAmount} from "../../ui/finance/MoneyAmount";
import {Panel} from "../../shared/components/ui";
import type {Account} from "../../shared/model/accounts";
import {Button} from "../../ui/controls/Button";
import {OverflowMenu, OverflowMenuItem} from "../../ui/controls/OverflowMenu";
import {motionEase} from "../../shared/lib/motion";

export function AccountCard({account, inactive = false, privateAmounts = false, newlyCreated = false, onOpenDetail, onEdit, onDelete, onEntryComplete}: {
  account: Account;
  inactive?: boolean;
  privateAmounts?: boolean;
  newlyCreated?: boolean;
  onOpenDetail: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onEntryComplete: () => void;
}) {
  const reduceMotion = useReducedMotion() !== false;
  const transition = reduceMotion ? {duration: 0} : {duration: 0.18, ease: motionEase};
  return <motion.div
    className="account-card-layout"
    layout
    transition={transition}
    initial={newlyCreated && !reduceMotion ? {opacity: 0, y: -2} : false}
    animate={{opacity: 1, y: 0}}
    onAnimationComplete={() => {if (newlyCreated) onEntryComplete();}}
  >
    <Panel className={`account-card${inactive ? " inactive-account" : ""}`}>
      <i style={{background: account.color}} aria-hidden="true" />
      <div className="account-card-heading"><div><span>{account.kind_display}</span><strong>{account.name}</strong></div><b><MoneyAmount value={account.balance} privateAmounts={privateAmounts} label={`Saldo de ${account.name}`} /></b></div>
      <small>{account.bank_link ? `Vinculada a ${account.bank_link.display_name}` : "Cuenta manual"}</small>
      <div className="account-card-actions">
        {inactive ? <Button variant="secondary" onClick={onEdit}>Editar</Button> : <Button variant="secondary" onClick={onOpenDetail}>Abrir detalle</Button>}
        {inactive ? <OverflowMenu label={`Acciones de ${account.name}`} placement="top"><OverflowMenuItem className="ui-overflow-menu__item--danger" onClick={onDelete}><Trash2 aria-hidden="true" />Eliminar</OverflowMenuItem></OverflowMenu> : <OverflowMenu label={`Acciones de ${account.name}`} placement="top">
          <OverflowMenuItem onClick={onEdit}><Pencil aria-hidden="true" />Editar</OverflowMenuItem>
          <OverflowMenuItem className="ui-overflow-menu__item--danger" onClick={onDelete}><Trash2 aria-hidden="true" />Eliminar</OverflowMenuItem>
        </OverflowMenu>}
      </div>
    </Panel>
  </motion.div>;
}
