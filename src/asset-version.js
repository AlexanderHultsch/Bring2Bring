import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DOMAIN_DIR = path.join(__dirname, 'domain');

const DIGEST_LENGTH = 12;

function collectFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function hashDirectories(dirs) {
  const files = dirs.flatMap((dir) => collectFiles(dir));
  files.sort();

  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(file));
  }
  return hash.digest('hex').slice(0, DIGEST_LENGTH);
}

const assetVersion = hashDirectories([PUBLIC_DIR, DOMAIN_DIR]);

export function computeAssetVersion() {
  return assetVersion;
}
