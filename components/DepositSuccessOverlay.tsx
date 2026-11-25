import React from 'react';
import PaymentSuccessOverlay from './PaymentSuccessOverlay';
import { useAppLanguage } from '../localization/useAppLanguage';

import type { RgbBackupStatus } from '../services/protocols/rgbBackup';

interface Props {
  visible: boolean;
  ticker: string;
  rgbContract?: string;
  network?: string;
  account?: string;
  amountLabel?: string;
  amountIsBalanceChange?: boolean;
  backup?: RgbBackupStatus;
  receivedAt?: number;
  onBackup?: () => void;
  onDone: () => void;
  onActivity?: () => void;
}

/** A deposit that landed, on the shared success overlay. */
export default function DepositSuccessOverlay({ visible, ticker, rgbContract, network, account, amountLabel, amountIsBalanceChange, onDone, onActivity, backup, receivedAt, onBackup }: Props) {
  const { language } = useAppLanguage();
  const it = language === 'it';
  return <PaymentSuccessOverlay
    visible={visible}
    title={it ? 'Pagamento ricevuto' : 'Payment received'}
    amountLabel={amountLabel ? `+${amountLabel}` : ticker}
    subtitle={amountLabel ? (amountIsBalanceChange ? (it ? 'Aumento del saldo rilevato' : 'Detected balance increase') : undefined) : (it ? 'Importo nei dettagli attività' : 'See Activity for the amount')}
    rows={[
      { label: 'Asset', value: ticker },
      ...(rgbContract ? [{ label: it ? 'Contratto RGB' : 'RGB contract', value: rgbContract }] : []),
      { label: it ? 'Accreditato su' : 'Received in', value: account ?? (it ? 'Vedi attività' : 'See Activity') },
      ...(backup ? [{ label: 'Backup RGB', value: backup.state === 'failed' ? (it ? 'Da riprovare' : 'Retry needed')
        : backup.state === 'backing-up' ? (it ? 'In corso…' : 'Backing up…')
        : backup.lastBackupAt ? new Date(backup.lastBackupAt).toLocaleString() : (it ? 'Primo backup in attesa' : 'First backup pending') }] : []),
      ...(network && network !== 'all layers' ? [{ label: it ? 'Tramite' : 'Via', value: network }] : []),
    ]}
    onDone={onDone}
    secondary={backup && onBackup && (backup.state === 'failed' || (backup.state !== 'backing-up' && (!backup.lastBackupAt || backup.lastBackupAt < (receivedAt ?? 0))))
      ? { label: it ? 'Esegui il backup RGB' : 'Back up RGB data', onPress: onBackup }
      : onActivity ? { label: it ? 'Vedi attività' : 'View in Activity', onPress: onActivity } : undefined}
  />;
}
