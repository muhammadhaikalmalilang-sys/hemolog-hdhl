import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function linearToSrgb(channel: number): number {
  const clamped = Math.max(0, Math.min(1, channel));
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

function oklabToHex(L: number, a: number, b: number, alpha?: number): string {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  const r = Math.round(linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255);
  const g = Math.round(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255);
  const bl = Math.round(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255);

  const hex =
    '#' +
    [r, g, bl]
      .map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0'))
      .join('');

  if (alpha !== undefined && alpha < 1) {
    const aHex = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
      .toString(16)
      .padStart(2, '0');
    return hex + aHex;
  }

  return hex;
}

function parseNumericToken(token: string, percentScale: number): number {
  const trimmed = token.trim();
  if (trimmed === 'none') return 0;
  if (trimmed.endsWith('%')) {
    return (parseFloat(trimmed.slice(0, -1)) / 100) * percentScale;
  }
  return parseFloat(trimmed);
}

function parseHueRadians(token: string): number {
  const trimmed = token.trim().toLowerCase();
  if (trimmed === 'none') return 0;
  if (trimmed.endsWith('rad')) return parseFloat(trimmed.slice(0, -3));
  if (trimmed.endsWith('turn')) return parseFloat(trimmed.slice(0, -4)) * Math.PI * 2;
  if (trimmed.endsWith('grad')) return (parseFloat(trimmed.slice(0, -4)) * Math.PI) / 200;
  const deg = trimmed.endsWith('deg') ? parseFloat(trimmed.slice(0, -3)) : parseFloat(trimmed);
  return (deg * Math.PI) / 180;
}

function convertCssColorsToSrgb(css: string): string {
  return css
    .replace(/oklch\(([^()]+)\)/gi, (full, body: string) => {
      const [colorPart, alphaPart] = body.split('/').map((s) => s.trim());
      const parts = colorPart.split(/\s+/).filter(Boolean);
      if (parts.length < 3) return full;
      const L = parseNumericToken(parts[0], 1);
      const C = parseNumericToken(parts[1], 0.4);
      const H = parseHueRadians(parts[2]);
      const alpha = alphaPart !== undefined ? parseNumericToken(alphaPart, 1) : undefined;
      if (Number.isNaN(L) || Number.isNaN(C) || Number.isNaN(H)) return full;
      return oklabToHex(L, C * Math.cos(H), C * Math.sin(H), alpha);
    })
    .replace(/oklab\(([^()]+)\)/gi, (full, body: string) => {
      const [colorPart, alphaPart] = body.split('/').map((s) => s.trim());
      const parts = colorPart.split(/\s+/).filter(Boolean);
      if (parts.length < 3) return full;
      const L = parseNumericToken(parts[0], 1);
      const a = parseNumericToken(parts[1], 0.4);
      const b = parseNumericToken(parts[2], 0.4);
      const alpha = alphaPart !== undefined ? parseNumericToken(alphaPart, 1) : undefined;
      if (Number.isNaN(L) || Number.isNaN(a) || Number.isNaN(b)) return full;
      return oklabToHex(L, a, b, alpha);
    })
    .replace(/color-mix\(\s*in\s+oklab\s*,/gi, 'color-mix(in srgb,')
    .replace(/\s+in\s+oklab\b/gi, '');
}

function consistentSrgbCssPlugin(): Plugin {
  return {
    name: 'consistent-srgb-css',
    enforce: 'post',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('.css')) return null;
      const transformed = convertCssColorsToSrgb(code);
      if (transformed === code) return null;
      return {code: transformed, map: null};
    },
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type === 'asset' && asset.fileName.endsWith('.css')) {
          const raw =
            typeof asset.source === 'string'
              ? asset.source
              : Buffer.from(asset.source).toString('utf8');
          asset.source = convertCssColorsToSrgb(raw);
        }
      }
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      consistentSrgbCssPlugin(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'icon.svg'],
        manifest: {
          id: '/',
          name: 'HemoLog — Digital Logbook Perawat Hemodialisa',
          short_name: 'HemoLog',
          description:
            'Sistem Digital Logbook Perawat Hemodialisa real-time dengan kontrol akses berbasis peran, verifikasi tindakan klinis, jadwal dinas, dan laporan unit HD.',
          theme_color: '#0B5A8E',
          background_color: '#f8fafc',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          cleanupOutdatedCaches: true,
          skipWaiting: true,
          clientsClaim: true,
          globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
            if (id.includes('lucide-react') || id.includes('motion')) return 'vendor-ui';
            return undefined;
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
