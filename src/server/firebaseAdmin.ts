import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore as getAdminFirestore } from 'firebase-admin/firestore';

/**
 * Firebase Admin must always target the RestaurantOS Firebase project.
 *
 * Google Cloud Run / AI Studio may expose a different ambient Google Cloud
 * project through ADC (for example the hosting/runtime project). Relying on
 * initializeApp() without an explicit projectId can therefore make Admin Auth
 * call the wrong Identity Toolkit project.
 */
const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID?.trim()
  || process.env.VITE_FIREBASE_PROJECT_ID?.trim()
  || 'project-0edd3716-fc3b-40b7-b96';

const adminApp =
  getApps().length > 0
    ? getApps()[0]
    : initializeApp({ projectId: FIREBASE_PROJECT_ID });

export const adminAuth = getAdminAuth(adminApp);
export const adminDb = getAdminFirestore(adminApp);

export const FIREBASE_ADMIN_PROJECT_ID = FIREBASE_PROJECT_ID;

export const SYSTEM_SERVER_UID =
  process.env.SYSTEM_SERVER_UID?.trim() || 'restaurantos-system-server';
