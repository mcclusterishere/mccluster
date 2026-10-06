import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import ActionNetworkScreen from '../../src/ActionNetworkScreen';

/**
 * NETWORK — the account coin on the primary bar.
 *
 * This is now the native Action Network, not a browser hand-off.
 */
export default function NetworkRoom() {
  const params = useLocalSearchParams<{ returnTo?: string | string[] }>();
  const returnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  return <ActionNetworkScreen returnTo={returnTo} />;
}
