// `npm run dev`: the API server plus Vite with hot reload in front of it.
import { createServer } from 'vite';
import { start } from './index.ts';

start();
const vite = await createServer({ configFile: new URL('../vite.config.ts', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1') });
await vite.listen();
vite.printUrls();
