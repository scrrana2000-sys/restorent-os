import React, { useEffect, useState } from 'react';
import {
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  getRedirectResult,
  setPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver
} from 'firebase/auth';
import { auth } from '../config/firebase';
import { UtensilsCrossed, Loader2, ShieldCheck, AlertCircle, ArrowLeft } from 'lucide-react';

const DEEP_LINK_CALLBACK = 'restaurantos://auth/callback';

export const CustomTabAuthPage: React.FC = () => {
  const [statusText, setStatusText] = useState<string>('Preparing Google authentication...');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState<boolean>(true);
  // Populated once Google auth has actually finished. Many Android browsers
  // (Chrome included, depending on version/build) silently block a
  // script-triggered navigation to a custom URI scheme (restaurantos://...)
  // when it isn't the direct result of a user tap - which is exactly what
  // happens here, since this runs inside an async effect after the page
  // reloads from Google's redirect. That made sign-in "complete" but never
  // hand control back to the app. We still attempt the automatic redirect,
  // but we also render a real, tappable button with this as its href so the
  // user always has a guaranteed way back in (a genuine tap always works).
  const [returnTarget, setReturnTarget] = useState<string | null>(null);

  const returnToApp = (status: 'success' | 'cancelled' | 'error', data?: {
    uid?: string;
    googleIdToken?: string;
    googleAccessToken?: string;
    error?: string;
  }) => {
    let target = `${DEEP_LINK_CALLBACK}?status=${status}`;
    if (data?.uid) target += `&uid=${encodeURIComponent(data.uid)}`;
    if (data?.googleIdToken) target += `&googleIdToken=${encodeURIComponent(data.googleIdToken)}`;
    if (data?.googleAccessToken) target += `&googleAccessToken=${encodeURIComponent(data.googleAccessToken)}`;
    if (data?.error) target += `&error=${encodeURIComponent(data.error)}`;

    setStatusText('Returning to RestaurantOS app...');
    setReturnTarget(target);
    setIsProcessing(false);

    // Best-effort automatic attempt. Works on many devices/browsers.
    window.location.href = target;

    // Fallback attempt slightly later in case the first one was ignored
    // because it raced the page still settling after the redirect reload.
    window.setTimeout(() => {
      window.location.href = target;
    }, 400);
  };

  useEffect(() => {
    let isMounted = true;

    async function handleAuth() {
      try {
        await setPersistence(auth, browserLocalPersistence);

        // 1. Check if we just completed a redirect flow from Google
        // Use the same resolver as everywhere else in the app (authService.ts)
        // so this call consistently reads the same pending-redirect state.
        setStatusText('Checking authentication response...');
        const redirectResult = await getRedirectResult(auth, browserPopupRedirectResolver);

        if (redirectResult) {
          setStatusText('Authentication successful! Finalizing session...');
          const credential = GoogleAuthProvider.credentialFromResult(redirectResult);
          const googleIdToken = (credential as any)?.idToken || '';
          const googleAccessToken = (credential as any)?.accessToken || '';

          returnToApp('success', {
            uid: redirectResult.user.uid,
            googleIdToken,
            googleAccessToken
          });
          return;
        }

        // 2. If already logged in, extract token and return
        if (auth.currentUser) {
          setStatusText('Existing session detected. Returning to RestaurantOS...');
          returnToApp('success', {
            uid: auth.currentUser.uid
          });
          return;
        }

        // 3. Start Google sign-in.
        // NOTE: signInWithRedirect requires a full page reload to come back and
        // read getRedirectResult() - inside an Android Custom Tab this reload
        // frequently races Chrome's IndexedDB/storage-partition initialization,
        // so the result silently comes back empty and the user has to manually
        // refresh (sometimes more than once) before it's picked up. A Custom
        // Tab is a full Chrome tab, so signInWithPopup works fine here and
        // finishes in the SAME page load - no reload, no race. Use it as the
        // primary method and only fall back to redirect if the popup itself
        // is blocked.
        setStatusText('Opening Google account chooser...');
        const provider = new GoogleAuthProvider();
        provider.setCustomParameters({
          prompt: 'select_account'
        });

        try {
          const popupResult = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
          const credential = GoogleAuthProvider.credentialFromResult(popupResult);
          const googleIdToken = (credential as any)?.idToken || '';
          const googleAccessToken = (credential as any)?.accessToken || '';

          returnToApp('success', {
            uid: popupResult.user.uid,
            googleIdToken,
            googleAccessToken
          });
          return;
        } catch (popupErr: any) {
          const popupCode = popupErr?.code || '';
          if (popupCode === 'auth/popup-closed-by-user' || popupCode === 'auth/cancelled-popup-request') {
            returnToApp('cancelled');
            return;
          }
          if (popupCode !== 'auth/popup-blocked' && popupCode !== 'auth/operation-not-supported-in-this-environment') {
            throw popupErr;
          }
          // Popup genuinely blocked/unsupported - fall back to redirect.
          console.warn('[RestaurantOS CustomTabAuth] Popup unavailable, falling back to redirect:', popupCode);
        }

        // Trigger redirect within Custom Tab (fallback only)
        await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
      } catch (err: any) {
        if (!isMounted) return;
        console.error('[RestaurantOS CustomTabAuth] Error during OAuth:', err);

        const code = err?.code || '';
        const message = err?.message || 'Authentication failed';

        // Check if missing initial state due to storage partitioning
        if (code === 'auth/missing-initial-state' || message.includes('missing initial state')) {
          setErrorMessage('Storage partitioning detected. Please tap below to sign in directly.');
          setIsProcessing(false);
          return;
        }

        if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
          returnToApp('cancelled');
          return;
        }

        setErrorMessage(message);
        setIsProcessing(false);
      }
    }

    handleAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  const handleManualPopup = async () => {
    setIsProcessing(true);
    setErrorMessage(null);
    setStatusText('Connecting to Google...');

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: 'select_account'
      });

      const result = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const googleIdToken = (credential as any)?.idToken || '';
      const googleAccessToken = (credential as any)?.accessToken || '';

      returnToApp('success', {
        uid: result.user.uid,
        googleIdToken,
        googleAccessToken
      });
    } catch (err: any) {
      setIsProcessing(false);
      if (err?.code === 'auth/popup-closed-by-user') {
        setErrorMessage('Sign-in cancelled. You can try again or return to the app.');
      } else {
        setErrorMessage(err?.message || 'Authentication could not be completed.');
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 select-none">
      <div className="w-full max-w-sm bg-slate-900/90 border border-slate-800 rounded-3xl p-8 shadow-2xl backdrop-blur-xl flex flex-col items-center text-center">
        {/* App Logo */}
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white shadow-xl shadow-indigo-600/30 mb-6">
          <UtensilsCrossed className="w-8 h-8" />
        </div>

        <h1 className="text-xl font-bold text-white tracking-tight mb-2">
          RestaurantOS Authentication
        </h1>

        {returnTarget ? (
          <div className="w-full my-6">
            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-4 mb-5 text-left flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <p className="text-xs text-emerald-300 leading-relaxed font-medium">
                {statusText}
              </p>
            </div>
            <a
              href={returnTarget}
              className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold py-3.5 px-4 rounded-xl text-sm transition-all shadow-md active:scale-98"
            >
              <span>Tap to Return to RestaurantOS App</span>
            </a>
          </div>
        ) : isProcessing ? (
          <div className="flex flex-col items-center my-6 space-y-4">
            <Loader2 className="w-9 h-9 text-indigo-500 animate-spin" />
            <p className="text-sm text-slate-300 font-medium animate-pulse">
              {statusText}
            </p>
          </div>
        ) : (
          <div className="w-full my-6">
            {errorMessage ? (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 mb-5 text-left flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300 leading-relaxed font-medium">
                  {errorMessage}
                </p>
              </div>
            ) : null}

            <button
              onClick={handleManualPopup}
              className="w-full flex items-center justify-center gap-3 bg-white text-slate-900 hover:bg-slate-100 font-semibold py-3.5 px-4 rounded-xl text-sm transition-all shadow-md active:scale-98 mb-3"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>
        )}

        {/* Cancel / Return to App Button */}
        {!returnTarget && (
          <button
            onClick={() => returnToApp('cancelled')}
            className="flex items-center justify-center gap-2 text-xs font-semibold text-slate-400 hover:text-white py-2 px-4 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Cancel & Return to RestaurantOS</span>
          </button>
        )}
      </div>

      <p className="text-[11px] text-slate-600 mt-6 flex items-center gap-1.5 font-medium">
        <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
        Official Google OAuth 2.0 Security
      </p>
    </div>
  );
};
