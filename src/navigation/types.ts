import { NavigatorScreenParams } from '@react-navigation/native';

export type BookSessionMode = 'read' | 'listen';

export type RootStackParamList = {
  Auth: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  BookSession: { bookId: string; mode: BookSessionMode; resumeFromAudio?: boolean };
};

export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
};

export type MainTabParamList = {
  Library: NavigatorScreenParams<LibraryStackParamList>;
  Add: undefined;
  Settings: undefined;
};

export type LibraryStackParamList = {
  LibraryHome:
    | {
        openAdd?: number;
      }
    | undefined;
  BookDetail: { bookId: string };
};
