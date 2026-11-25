import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __hemologApplyPwaUpdate?: () => Promise<void>;
  }
}

const PWA_SESSION_DISMISS_KEY = 'hemolog:pwa-update-dismissed-session';
const PWA_SNOOZE_UNTIL_KEY = 'hemolog:pwa-update-snooze-until';

export function isPwaUpdateDismissed(): boolean {
  try {
    if (window.sessionStorage.getItem(PWA_SESSION_DISMISS_KEY) === '1') {
      return true;
    }
    const snoozeUntil = Number(window.localStorage.getItem(PWA_SNOOZE_UNTIL_KEY) || '0');
    if (Number.isFinite(snoozeUntil) && snoozeUntil > Date.now()) {
      return true;
    }
  } catch {
    // Ignore storage access errors in restricted webviews
  }
  return false;
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.__hemologApplyPwaUpdate = () => updateSW(true);
      if (!isPwaUpdateDismissed()) {
        window.dispatchEvent(new CustomEvent('hemolog:pwa-update'));
      }
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      let lastCheckAt = Date.now();
      const checkForUpdate = () => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        if (isPwaUpdateDismissed()) return;
        const now = Date.now();
        if (now - lastCheckAt < 60 * 60 * 1000) return;
        lastCheckAt = now;
        void registration.update().catch(() => undefined);
      };

      window.setInterval(checkForUpdate, 60 * 60 * 1000);
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
