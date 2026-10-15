import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// No `define` for API keys here — ever. PLAN.md section 22.4.
// Gemini calls go through the local server (server.mjs), which holds the key;
// see src/services/geminiClient.ts. Pinokio puts the key in the environment of
// every script, so any define reading the environment would bake it into the
// page. server.mjs refuses to start if it finds the key in the build.
//
// To run the app: `npm run build`, then `npm start` (http://localhost:7800).
// There is deliberately no dev server: it would need a second, unguarded copy
// of the key-forwarding code.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
