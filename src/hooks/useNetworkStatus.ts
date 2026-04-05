import { useState, useEffect, useRef } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import { flush } from '@/services/sync/offlineQueue';
import { logger } from '@/utils/logger';

interface UseNetworkStatusReturn {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  isFlushing: boolean;
}

export function useNetworkStatus(): UseNetworkStatusReturn {
  const [state, setState] = useState<NetInfoState | null>(null);
  const [isFlushing, setIsFlushing] = useState(false);
  const wasConnected = useRef<boolean | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState) => {
      const isNowConnected = netState.isConnected ?? false;
      const wasPreviouslyConnected = wasConnected.current;

      // Reconnected: was false/null, now true
      if (wasPreviouslyConnected === false && isNowConnected) {
        logger.info('Network reconnected — flushing offline queue');
        setIsFlushing(true);
        flush()
          .then(({ flushed, failed }) => {
            logger.info(`Offline queue flushed: ${flushed} ops, ${failed} failed`);
          })
          .catch((err) => logger.error('Offline queue flush error', err))
          .finally(() => setIsFlushing(false));
      }

      wasConnected.current = isNowConnected;
      setState(netState);
    });

    // Fetch initial state
    NetInfo.fetch().then((netState) => {
      wasConnected.current = netState.isConnected ?? false;
      setState(netState);
    });

    return unsubscribe;
  }, []);

  return {
    isConnected: state?.isConnected ?? true,
    isInternetReachable: state?.isInternetReachable ?? null,
    isFlushing,
  };
}
