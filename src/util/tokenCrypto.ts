import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { hostname, networkInterfaces, platform, userInfo } from 'os';

/**
 * At-rest encryption for the cached PETLIBRO session token.
 *
 * This is *defense in depth*, not a real secret manager. The encryption key
 * is derived from machine-stable identifiers (hostname, primary MAC, OS
 * username, platform). An attacker who can read the token file *and* run
 * code on the same machine can trivially recover the key — but a casual
 * disk leak (backup snapshot, misconfigured rsync, etc.) won't expose it.
 *
 * The PETLIBRO password itself still lives in plaintext in config.json;
 * encrypting the token only mitigates session reuse against the *same*
 * account from a *different* machine.
 *
 * Format on disk: `{ "v": 1, "iv": "<hex>", "tag": "<hex>", "ct": "<hex>", "email": "..." }`
 *
 * Backward compatibility: if a legacy plaintext file is encountered (no `v`
 * field), `decrypt()` returns null and the platform will re-login.
 */

const ALGORITHM = 'aes-256-gcm';

interface EncryptedTokenFile {
  v: 1;
  email: string;
  iv: string;
  tag: string;
  ct: string;
}

function deriveKey(): Buffer {
  // Pick the first non-internal MAC address as a stable machine fingerprint.
  // Fallback to hostname-only if no MACs are available (some containers).
  let mac = '';
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    if (!list) continue;
    for (const i of list) {
      if (!i.internal && i.mac && i.mac !== '00:00:00:00:00:00') {
        mac = i.mac;
        break;
      }
    }
    if (mac) break;
  }

  const seed = [
    'homebridge-petlibro-granary',
    platform(),
    hostname(),
    userInfo().username || 'nobody',
    mac,
  ].join('|');

  return createHash('sha256').update(seed, 'utf8').digest();
}

export function encryptToken(token: string, email: string): string {
  const key = deriveKey();
  const iv = randomBytes(12); // GCM standard
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  const file: EncryptedTokenFile = {
    v: 1,
    email,
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    ct: ct.toString('hex'),
  };
  return JSON.stringify(file);
}

export function decryptToken(
  contents: string,
  expectedEmail: string,
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') return null;
  const file = parsed as Partial<EncryptedTokenFile> & { token?: string };

  // Legacy plaintext file from older plugin versions — ignore so we re-login
  // and write a fresh encrypted file on the next mutation.
  if (file.v !== 1) return null;

  if (file.email !== expectedEmail) return null;
  if (!file.iv || !file.tag || !file.ct) return null;

  try {
    const key = deriveKey();
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(file.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(file.tag, 'hex'));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(file.ct, 'hex')),
      decipher.final(),
    ]);
    return pt.toString('utf8');
  } catch {
    // Most likely the machine fingerprint changed (new NIC, host rename).
    // Returning null causes a clean re-login on next start.
    return null;
  }
}
