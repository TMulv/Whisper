// @react-native-firebase initializes automatically via:
//   Android: google-services.json in project root
//   iOS: GoogleService-Info.plist in project root
// No explicit initializeApp() call needed.

import firestore from '@react-native-firebase/firestore';

// Enable offline persistence (Firestore caches data locally so reads work offline)
firestore().settings({ persistence: true, cacheSizeBytes: firestore.CACHE_SIZE_UNLIMITED });

export { default as auth } from '@react-native-firebase/auth';
export { default as firestoreInstance } from '@react-native-firebase/firestore';
