import auth, { FirebaseAuthTypes } from '@react-native-firebase/auth';

export async function signInWithEmail(email: string, password: string): Promise<FirebaseAuthTypes.UserCredential> {
  return auth().signInWithEmailAndPassword(email, password);
}

export async function signUpWithEmail(email: string, password: string): Promise<FirebaseAuthTypes.UserCredential> {
  return auth().createUserWithEmailAndPassword(email, password);
}

export async function signOut(): Promise<void> {
  return auth().signOut();
}

export function onAuthStateChanged(callback: (user: FirebaseAuthTypes.User | null) => void): () => void {
  return auth().onAuthStateChanged(callback);
}

export function getCurrentUser(): FirebaseAuthTypes.User | null {
  return auth().currentUser;
}
