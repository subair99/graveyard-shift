// Requirements: 2.8, 9.6, 11.4
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Validates: Requirements 2.8, 9.6, 11.4

const FIXTURES_DIR = join(process.cwd(), 'tests', 'engine', 'fixtures');
const REQUIRED_DIRS = ['inflight', 'ip', 'lodash.set'];
const EXPECTED_KEYS = ['body', 'cacheKey', 'fetchedAt', 'sourceUrl', 'status'];

const KEYWORDS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: 'Authorization', pattern: /authorization/i },
  { label: 'Bearer', pattern: /bearer/i },
  { label: 'ghp_ token shape', pattern: /ghp_[A-Za-z0-9]{20,}/ },
  { label: 'github_pat_ token shape', pattern: /github_pat_[A-Za-z0-9_]{20,}/ },
  { label: 'gh[osur]_ token shape', pattern: /gh[osur]_[A-Za-z0-9]{20,}/ },
];

export interface Detection {
  readonly file: string;
  readonly match: string;
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else out.push(full);
  }
  return out.sort();
}

/** Returns file + matched label only; never content and never the token value. */
function scanFiles(files: readonly string[], root: string, token: string | undefined): Detection[] {
  const found: Detection[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    const name = relative(root, file);
    if (token !== undefined && token.length > 0 && text.includes(token)) {
      found.push({ file: name, match: 'fixture contains the GITHUB_TOKEN value' });
    }
    for (const { label, pattern } of KEYWORDS) {
      if (pattern.test(text)) found.push({ file: name, match: label });
    }
  }
  return found;
}

/**
 * Reads GITHUB_TOKEN from `env`, loading `.env` first when the variable is not set. A missing
 * `.env` (code ENOENT) is not an error: the token-shape checks still run. Any other loader error
 * is rethrown with a fixed message that carries no file content and no value.
 */
export function loadOptionalEnvToken(
  loadEnvFile: (path: string) => void = (path) => process.loadEnvFile(path),
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  if (!env.GITHUB_TOKEN) {
    try {
      loadEnvFile(join(process.cwd(), '.env'));
    } catch (error) {
      const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
      if (code !== 'ENOENT') throw new Error('loading .env failed with an error other than ENOENT');
    }
  }
  const value = env.GITHUB_TOKEN;
  return value && value.length > 0 ? value : undefined;
}

function resolveToken(): string | undefined {
  return loadOptionalEnvToken();
}

describe('fixture credential scan', () => {
  const files = listFiles(FIXTURES_DIR);

  it('finds no credentials in any fixture file', () => {
    const detections = scanFiles(files, FIXTURES_DIR, resolveToken());
    expect(detections.map((d) => `${d.file}: ${d.match}`)).toEqual([]);
  });

  it('has non-empty inflight, ip and lodash.set directories', () => {
    for (const dir of REQUIRED_DIRS) {
      const full = join(FIXTURES_DIR, dir);
      expect(existsSync(full) && statSync(full).isDirectory(), `${dir} exists`).toBe(true);
      expect(listFiles(full).length, `${dir} is non-empty`).toBeGreaterThan(0);
    }
  });

  it('keeps every file as valid JSON with exactly the five credential-free keys', () => {
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const name = relative(FIXTURES_DIR, file);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        throw new Error(`${name} is not valid JSON`);
      }
      expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), `${name} is an object`).toBe(true);
      const record = parsed as Record<string, unknown>;
      expect(Object.keys(record).sort(), `${name} keys`).toEqual(EXPECTED_KEYS);
      expect(typeof record.cacheKey, `${name} cacheKey`).toBe('string');
      expect(typeof record.sourceUrl, `${name} sourceUrl`).toBe('string');
      const status = record.status;
      expect(Number.isInteger(status) && (status as number) >= 200 && (status as number) <= 599, `${name} status`).toBe(true);
      expect(
        typeof record.fetchedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(record.fetchedAt),
        `${name} fetchedAt is second-precision UTC`,
      ).toBe(true);
    }
  });

  it('loadOptionalEnvToken: a loader that throws ENOENT yields undefined without throwing', () => {
    const missing = (): never => {
      throw Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' });
    };
    expect(loadOptionalEnvToken(missing, {})).toBeUndefined();
  });

  it('loadOptionalEnvToken: another loader error is rethrown with a fixed message and no token', () => {
    const secret = 'fake-token-value-for-this-test';
    const broken = (): never => {
      throw Object.assign(new Error(`bad line GITHUB_TOKEN=${secret}`), { code: 'EACCES' });
    };
    let message = '';
    try {
      loadOptionalEnvToken(broken, {});
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toBe('loading .env failed with an error other than ENOENT');
    expect(message.includes(secret)).toBe(false);
  });

  it('loadOptionalEnvToken: does not call the loader when the token is already set', () => {
    let calls = 0;
    const loader = (): void => {
      calls += 1;
    };
    expect(loadOptionalEnvToken(loader, { GITHUB_TOKEN: 'x' })).toBe('x');
    expect(calls).toBe(0);
  });

  it('scanner self-test: detects a fake token and a header, ignores a clean file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fixture-scan-'));
    try {
      const tokenFile = join(dir, 'a.json');
      const headerFile = join(dir, 'b.json');
      const cleanFile = join(dir, 'c.json');
      writeFileSync(tokenFile, JSON.stringify({ body: 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1' }));
      writeFileSync(headerFile, 'Authorization: Bearer x');
      writeFileSync(cleanFile, JSON.stringify({ body: { name: 'ip' } }));
      const detections = scanFiles([tokenFile, headerFile, cleanFile], dir, undefined);
      const names = new Set(detections.map((d) => d.file));
      expect(names).toEqual(new Set(['a.json', 'b.json']));
      expect(detections.some((d) => d.file === 'a.json' && d.match === 'ghp_ token shape')).toBe(true);
      expect(detections.some((d) => d.file === 'b.json' && d.match === 'Authorization')).toBe(true);
      const withToken = scanFiles([cleanFile], dir, 'not-in-file-token');
      expect(withToken).toEqual([]);
      writeFileSync(cleanFile, 'xx secret-value-123 yy');
      const hit = scanFiles([cleanFile], dir, 'secret-value-123');
      expect(hit).toEqual([{ file: 'c.json', match: 'fixture contains the GITHUB_TOKEN value' }]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
