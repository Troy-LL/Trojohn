import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cursor } from '@cursor/sdk';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), override: true });

const apiKey = process.env.CURSOR_API_KEY;
if (!apiKey) {
  console.error('CURSOR_API_KEY missing in .env');
  process.exit(1);
}

const models = await Cursor.models.list({ apiKey });
console.log(JSON.stringify(models, null, 2));
