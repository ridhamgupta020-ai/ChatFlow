import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import {
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true });

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let transitionId = 0;
    let unsubscribeProfile: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, (firebaseUser) => {
      const currentTransition = ++transitionId;
      unsubscribeProfile?.();
      unsubscribeProfile = undefined;

      if (!firebaseUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setUser(null);
      void initializeProfile(
        firebaseUser,
        () => currentTransition === transitionId,
        setUser,
        setLoading,
      ).then((profileUnsubscribe) => {
        if (currentTransition !== transitionId) {
          profileUnsubscribe?.();
          return;
        }
        unsubscribeProfile = profileUnsubscribe;
      }).catch((error: unknown) => {
        if (currentTransition !== transitionId) return;
        console.error('Failed to initialize the signed-in user profile.', error);
        setUser(null);
        setLoading(false);
      });
    });

    return () => {
      transitionId += 1;
      unsubscribeProfile?.();
      unsubscribeAuth();
    };
  }, []);

  useEffect(() => {
    if (!user?.uid) return;

    const userDocRef = doc(db, 'users', user.uid);
    const updatePresence = (isOnline: boolean) => {
      void setDoc(userDocRef, {
        isOnline,
        lastSeen: serverTimestamp(),
      }, { merge: true }).catch((error: unknown) => {
        console.error('Failed to update user presence.', error);
      });
    };

    const handleVisibilityChange = () => {
      updatePresence(document.visibilityState !== 'hidden');
    };
    const handleBeforeUnload = () => updatePresence(false);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      updatePresence(false);
    };
  }, [user?.uid]);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
};

async function initializeProfile(
  firebaseUser: FirebaseUser,
  isCurrentTransition: () => boolean,
  updateUser: React.Dispatch<React.SetStateAction<User | null>>,
  updateLoading: React.Dispatch<React.SetStateAction<boolean>>,
): Promise<() => void> {
  const userDocRef = doc(db, 'users', firebaseUser.uid);
  const previousProfile = await getDoc(userDocRef);
  const previousData = previousProfile.data();
  const legacyTokens = previousData?.fcmTokens;

  if (Array.isArray(legacyTokens) && legacyTokens.every((token) => typeof token === 'string')) {
    await setDoc(doc(db, 'users', firebaseUser.uid, 'private_data', 'notifications'), {
      fcmTokens: legacyTokens,
    }, { merge: true });
  }

  await setDoc(userDocRef, {
    uid: firebaseUser.uid,
    displayName: firebaseUser.displayName || 'Anonymous',
    photoURL: firebaseUser.photoURL ||
      `https://ui-avatars.com/api/?name=${encodeURIComponent(firebaseUser.displayName || 'Anonymous')}`,
    lastSeen: serverTimestamp(),
    isOnline: true,
    email: deleteField(),
    fcmTokens: deleteField(),
  }, { merge: true });

  await setDoc(doc(db, 'users', firebaseUser.uid, 'private_data', 'account'), {
    email: firebaseUser.email || '',
  }, { merge: true });

  return onSnapshot(userDocRef, (snapshot) => {
    if (!isCurrentTransition()) return;
    if (snapshot.exists()) {
      updateUser({ ...snapshot.data() as User, uid: firebaseUser.uid });
    }
    updateLoading(false);
  }, (error) => {
    if (!isCurrentTransition()) return;
    console.error(`Failed to subscribe to users/${firebaseUser.uid}.`, error);
    updateLoading(false);
  });
}
