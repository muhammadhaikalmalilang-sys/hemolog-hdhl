import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __hemologApplyPwaUpdate?: () => Promise<void>;
  }
}

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.__hemologApplyPwaUpdate = () => updateSW(true);
      window.dispatchEvent(new CustomEvent('hemolog:pwa-update'));
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      let lastCheckAt = Date.now();
      const checkForUpdate = () => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        const now = Date.now();
        if (now - lastCheckAt < 15 * 60 * 1000) return;
        lastCheckAt = now;
        void registration.update().catch(() => undefined);
      };

      window.setInterval(checkForUpdate, 30 * 60 * 1000);
      window.addEventListener('online', checkForUpdate);
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
