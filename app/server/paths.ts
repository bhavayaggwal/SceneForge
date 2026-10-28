import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const APP_ROOT = resolve(import.meta.dirname, '..');
export const REPO_ROOT = resolve(APP_ROOT, '..');
export const DATA_DIR = resolve(process.env.SF_DATA ?? join(REPO_ROOT, 'data', 'sceneforge'));
export const SCENES_DIR = join(DATA_DIR, 'scenes');
export const JOBS_DIR = join(DATA_DIR, 'jobs');
export const VIEWS_DIR = join(DATA_DIR, 'views');
export const DIST_DIR = join(APP_ROOT, 'dist');

for (const d of [DATA_DIR, SCENES_DIR, JOBS_DIR, VIEWS_DIR]) mkdirSync(d, { recursive: true });
