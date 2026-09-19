import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

const adminApp = getApps().length > 0 ? getApps()[0] : initializeApp();

export const adminAuth = getAdminAuth(adminApp);

export const SYSTEM_SERVER_UID =
  process.env.SYSTEM_SERVER_UID?.trim() || 'restaurantos-system-server';
