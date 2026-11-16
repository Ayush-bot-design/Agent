import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname || process.cwd(), 'src'),
      },
    },
    server: {
      // Bind to every interface so the sandboxed preview proxy can reach the dev server.
      host: '0.0.0.0',
      port: 5173,
      // Allow Arena's proxied preview host while keeping other hosts blocked.
      allowedHosts: ['.e2b.app'],
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: ['.e2b.app'],
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  };
});
