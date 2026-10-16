import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { z } from 'zod';

export default defineConfig(({ mode }) => {
  const envDir = fileURLToPath(new URL('../../', import.meta.url));
  const env = z
    .object({
      WEB_PORT: z.coerce.number().int().min(1).max(65535).default(5173),
      API_PROXY_TARGET: z
        .url()
        .refine((value) =>
          ['http:', 'https:'].includes(new URL(value).protocol),
        )
        .default('http://127.0.0.1:3000'),
    })
    .parse(loadEnv(mode, envDir, ''));
  const proxy = {
    '/api': {
      target: env.API_PROXY_TARGET,
      rewrite: (path: string) => path.replace(/^\/api/, ''),
    },
  };

  return {
    envDir,
    plugins: [react(), tailwindcss()],
    server: { port: env.WEB_PORT, proxy },
    preview: { proxy },
  };
});
