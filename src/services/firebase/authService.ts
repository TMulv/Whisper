import {
  getAuth,
  signInWithEmailAndPassword as fbSignIn,
  createUserWithEmailAndPassword as fbSignUp,
  signOut as fbSignOut,
  onAuthStateChanged as fbOnAuthStateChanged,
  sendPasswordResetEmail as fbSendPasswordReset,
} from '@react-native-firebase/auth';
import { FirebaseAuthTypes } from '@react-native-firebase/auth';

const auth = getAuth();

export async function signInWithEmail(email: string, password: string): Promise<FirebaseAuthTypes.UserCredential> {
  return fbSignIn(auth, email, password);
}

export async function signUpWithEmail(email: string, password: string): Promise<FirebaseAuthTypes.UserCredential> {
  return fbSignUp(auth, email, password);
}

export async function signOut(): Promise<void> {
  return fbSignOut(auth);
}

export function onAuthStateChanged(callback: (user: FirebaseAuthTypes.User | null) => void): () => void {
  return fbOnAuthStateChanged(auth, callback);
}

export async function sendPasswordReset(email: string): Promise<void> {
  return fbSendPasswordReset(auth, email);
}

export function getCurrentUser(): FirebaseAuthTypes.User | null {
  return auth.currentUser;
}
