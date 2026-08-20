import React, { useState } from 'react';
import { isAdultCategoryName } from '@/src/lib/adult-content';
import { isParentalLockEnabled, hasParentalPin, verifyParentalPin } from '@/src/state/parental';
import PinModal from '@/src/components/PinModal';

export function useParentalGate() {
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Call this instead of directly running the "open item" action. If the
  // category doesn't look like adult content, or the lock is off, it just
  // runs the action immediately — no PIN prompt in the way for normal use.
  const guard = async (categoryName: string | undefined, action: () => void) => {
    if (!isAdultCategoryName(categoryName)) {
      action();
      return;
    }
    const [enabled, has] = await Promise.all([isParentalLockEnabled(), hasParentalPin()]);
    if (!enabled || !has) {
      // Nothing configured to check against — don't silently block content
      // the person never asked to have gated.
      action();
      return;
    }
    setPendingAction(() => action);
  };

  const onSubmit = async (pin: string) => {
    const ok = await verifyParentalPin(pin);
    if (ok) {
      const action = pendingAction;
      setPendingAction(null);
      setError(null);
      action?.();
    } else {
      setError('PIN incorreto. Tente de novo.');
    }
  };

  const cancel = () => {
    setPendingAction(null);
    setError(null);
  };

  const modal = (
    <PinModal
      visible={!!pendingAction}
      title="Conteúdo bloqueado"
      subtitle="Digite o PIN do controle parental para continuar"
      onSubmit={onSubmit}
      onCancel={cancel}
      error={error}
    />
  );

  return { modal, guard };
}
