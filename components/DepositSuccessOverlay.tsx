import React from 'react';
import PaymentSuccessOverlay from './PaymentSuccessOverlay';
import { useAppLanguage } from '../localization/useAppLanguage';

interface Props {
  visible: boolean;
  ticker: string;
  network?: string;
  account?: string;
  amountLabel?: string;
  amountIsBalanceChange?: boolean;
  onDone: () => void;
  onActivity?: () => void;
}

/** A deposit that landed, on the shared success overlay. */
export default function DepositSuccessOverlay({ visible, ticker, network, account, amountLabel, amountIsBalanceChange, onDone, onActivity }: Props) {
  const { language } = useAppLanguage();
  const it = language === 'it';
  return <PaymentSuccessOverlay
    visible={visible}
    title={it ? 'Pagamento ricevuto' : 'Payment received'}
    amountLabel={amountLabel ? `+${amountLabel}` : ticker}
    subtitle={amountLabel ? (amountIsBalanceChange ? (it ? 'Aumento del saldo rilevato' : 'Detected balance increase') : undefined) : (it ? 'Importo nei dettagli attività' : 'See Activity for the amount')}
    rows={[
      { label: 'Asset', value: ticker },
      { label: it ? 'Accreditato su' : 'Received in', value: account ?? (it ? 'Vedi attività' : 'See Activity') },
      ...(network && network !== 'all layers' ? [{ label: it ? 'Tramite' : 'Via', value: network }] : []),
    ]}
    onDone={onDone}
    secondary={onActivity ? { label: it ? 'Vedi attività' : 'View in Activity', onPress: onActivity } : undefined}
  />;
}
