import { useState, useEffect } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

interface UseNetworkStatusReturn {
  isConnected: boolean;
  isInternetReachable: boolean | null;
}

export function useNetworkStatus(): UseNetworkStatusReturn {
  const [state, setState] = useState<NetInfoState | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((netState) => {
      setState(netState);
    });
    // Fetch initial state
    NetInfo.fetch().then(setState);
    return unsubscribe;
  }, []);

  return {
    isConnected: state?.isConnected ?? true,
    isInternetReachable: state?.isInternetReachable ?? null,
  };
}
