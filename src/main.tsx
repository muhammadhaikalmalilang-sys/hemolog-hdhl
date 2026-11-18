import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      let lastCheckAt = Date.now();
      const checkForUpdate = () => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) return;
        const now = Date.now();
        if (now - lastCheckAt < 30000) return;
        lastCheckAt = now;
        void registration.update().catch(() => undefined);
      };

      window.setInterval(checkForUpdate, 5 * 60 * 1000);
      window.addEventListener('online', checkForUpdate);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          checkForUpdate();
        }
      });
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
