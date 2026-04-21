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
  Library: NavigatorScreenParams<LibraryStackParamList>;
  Files: undefined;
  Add: undefined;
  Settings: undefined;
};

export type LibraryStackParamList = {
  LibraryHome:
    | {
        openAdd?: number;
        /** File delivered by iOS "Open with" / share sheet. LibraryScreen
         *  caches the file and pre-populates AddBookModal for the matching
         *  slot, leaving the other slot for the user to fill in. */
        incomingFile?: { uri: string; name: string; kind: 'audio' | 'epub' };
      }
    | undefined;
  BookDetail: { bookId: string };
  Reader: { bookId: string; resumeFromAudio?: boolean };
};
