import React from 'react';
import { Order } from '../../types/order';
import { ReceivePaymentModal } from './ReceivePaymentModal';

interface PaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  order: Order | null;
  onPaymentSuccess: (updatedOrder: Order) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  isOpen,
  onClose,
  order,
  onPaymentSuccess
}) => {
  return (
    <ReceivePaymentModal
      isOpen={isOpen}
      onClose={onClose}
      order={order}
      onPaymentSuccess={(updatedOrder) => {
        onPaymentSuccess(updatedOrder);
      }}
    />
  );
};

