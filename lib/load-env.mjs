/**
 * Load .env from project root. Call at startup so process.env has API keys etc.
 * .env is gitignored; use .env.example as a template.
 */

import dotenv from 'dotenv';
import path from 'path';
import { getRepoRoot } from './repo-root.mjs';

const projectRoot = getRepoRoot();
dotenv.config({ path: path.join(projectRoot, '.env') });
