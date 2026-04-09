import { createNavigationContainerRef } from '@react-navigation/native';
import { RootStackParamList } from './types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateRoot<RouteName extends keyof RootStackParamList>(
  name: RouteName,
  params: RootStackParamList[RouteName],
): void {
  if (navigationRef.isReady()) {
    navigationRef.navigate(name as any, params as any);
  }
}
