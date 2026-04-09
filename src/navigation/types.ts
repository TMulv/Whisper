import { NavigatorScreenParams } from '@react-navigation/native';

export type RootStackParamList = {
  Auth: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  Player: { bookId: string };
};

export type AuthStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
};

export type MainTabParamList = {
  Library: undefined;
  Settings: undefined;
};

export type LibraryStackParamList = {
  LibraryHome: undefined;
  BookDetail: { bookId: string };
  Reader: { bookId: string; resumeFromAudio?: boolean };
};
