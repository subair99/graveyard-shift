// Requirements: 13.25, 13.26, 13.27
import { describe, expect, it } from 'vitest';
import {
  GENERIC_USER_NAMES,
  describeIdentityFinding,
  findIdentity,
  identityValuesFromEnv,
  isWordMatchableUserName,
  redactIdentity,
  type IdentityValues,
} from '../../../src/proof/core/identity';

// All identity values here are fake.
const win = (userProfile: string, userName?: string): IdentityValues =>
  identityValuesFromEnv(
    { USERPROFILE: userProfile, ...(userName === undefined ? {} : { USERNAME: userName }) },
    'win32',
  );

describe('identityValuesFromEnv', () => {
  it('reads the four names, ignores empty and separator-only values, deduplicates', () => {
    const v = identityValuesFromEnv(
      { USERNAME: 'fakeuser1', USERPROFILE: 'C:\\Users\\fakeuser1', HOMEPATH: '\\', HOME: 'C:\\Users\\fakeuser1' },
      'win32',
    );
    expect(v.pathValues).toEqual(['C:\\Users\\fakeuser1']);
    expect(v.userName).toBe('fakeuser1');
    const e = identityValuesFromEnv({ USERNAME: '', HOME: '/', USERPROFILE: '' }, 'posix');
    expect(e).toEqual({ pathValues: [], userName: undefined });
  });
});

describe('path-valued identity forms', () => {
  const id = win('C:\\Users\\Quillon');
  const redact = (s: string) => redactIdentity(s, id, 'win32');

  it.each([
    ['native', 'C:\\Users\\Quillon\\x', '<user-home>\\x'],
    ['forward slash', 'C:/Users/Quillon/x', '<user-home>/x'],
    ['escaped back-slash', 'C:\\\\Users\\\\Quillon\\\\x', '<user-home>\\\\x'],
    ['file URL', 'file:///C:/Users/Quillon/x', '<user-home>/x'],
    ['extended-length', '\\\\?\\C:\\Users\\Quillon\\x', '<user-home>\\x'],
    ['case-insensitive on Windows', 'c:\\users\\QUILLON\\x', '<user-home>\\x'],
  ])('%s', (_name, input, expected) => {
    expect(redact(input)).toBe(expected);
    expect(findIdentity(input, id, 'win32').found).toBe(true);
  });

  it('matches a home directory with spaces, in plain and percent-encoded forms', () => {
    const spaced = win('C:\\Users\\Fake Person');
    expect(redactIdentity('C:\\Users\\Fake Person\\x', spaced, 'win32')).toBe('<user-home>\\x');
    expect(redactIdentity('file:///C:/Users/Fake%20Person/x', spaced, 'win32')).toBe('<user-home>/x');
    expect(redactIdentity('file:///C:/Users/Fake%20Person/x', spaced, 'win32')).not.toContain('%20');
  });

  it('matches percent-escape hex digits in either case on POSIX', () => {
    const posix = identityValuesFromEnv({ HOME: '/home/fake/caf\u00e9' }, 'posix');
    expect(redactIdentity('file:///home/fake/caf%C3%A9/x', posix, 'posix')).toBe('<user-home>/x');
    expect(redactIdentity('file:///home/fake/caf%c3%a9/x', posix, 'posix')).toBe('<user-home>/x');
  });

  it('is case-sensitive on POSIX', () => {
    const posix = identityValuesFromEnv({ HOME: '/home/Fakey' }, 'posix');
    expect(redactIdentity('/home/Fakey/a', posix, 'posix')).toBe('<user-home>/a');
    expect(redactIdentity('/home/fakey/a', posix, 'posix')).toBe('/home/fakey/a');
  });

  it('does not match a home directory inside a longer sibling name', () => {
    expect(redact('C:\\Users\\Quillon2\\x')).toBe('C:\\Users\\Quillon2\\x');
    expect(redact('C:\\Users\\Quillon-b')).toBe('C:\\Users\\Quillon-b');
    expect(redact('C:\\Users\\Quillon')).toBe('<user-home>');
  });

  it('prefers the longest form', () => {
    const both = identityValuesFromEnv({ USERPROFILE: 'C:\\Users\\Quillon', HOME: 'C:\\Users\\Quillon\\sub' }, 'win32');
    expect(redactIdentity('C:\\Users\\Quillon\\sub\\f', both, 'win32')).toBe('<user-home>\\f');
  });
});

describe('USERNAME rules', () => {
  it('a short name matches only in path context', () => {
    const id = win('D:\\elsewhere', 'ali');
    expect(redactIdentity('C:\\Users\\ali\\x', id, 'win32')).toBe('C:\\Users\\<user>\\x');
    expect(redactIdentity('C:/Users/ali/x', id, 'win32')).toBe('C:/Users/<user>/x');
    expect(redactIdentity('C:%5CUsers%5Cali%5Cx', id, 'win32')).toBe('C:%5CUsers%5C<user>%5Cx');
    expect(redactIdentity('hello ali, hi', id, 'win32')).toBe('hello ali, hi');
    expect(findIdentity('hello ali, hi', id, 'win32').found).toBe(false);
    expect(redactIdentity('C:\\Users\\ali2\\x', id, 'win32')).toBe('C:\\Users\\ali2\\x');
  });

  it('a bare generic name outside a path is not matched (L14), inside a path it is', () => {
    const id = win('D:\\elsewhere', 'Owner');
    expect(redactIdentity('the Owner of this', id, 'win32')).toBe('the Owner of this');
    expect(redactIdentity('C:\\Users\\Owner\\x', id, 'win32')).toBe('C:\\Users\\<user>\\x');
    expect(isWordMatchableUserName('Owner')).toBe(false);
    for (const generic of GENERIC_USER_NAMES) expect(isWordMatchableUserName(generic)).toBe(false);
  });

  it('a name of 4 or more characters off the list matches as a whole word', () => {
    const id = win('D:\\elsewhere', 'Quillon');
    expect(isWordMatchableUserName('Quillon')).toBe(true);
    expect(redactIdentity('by quillon, yes', id, 'win32')).toBe('by <user>, yes');
    expect(redactIdentity('quillon-b and xquillon and quillon_1', id, 'win32')).toBe(
      'quillon-b and xquillon and quillon_1',
    );
    expect(redactIdentity('C:\\Users\\Quillon\\x', id, 'win32')).toBe('C:\\Users\\<user>\\x');
  });

  it('is case-sensitive on POSIX', () => {
    const id = identityValuesFromEnv({ USERNAME: 'Quillon' }, 'posix');
    expect(redactIdentity('quillon Quillon', id, 'posix')).toBe('quillon <user>');
  });

  it('the user name inside a home directory is not replaced separately', () => {
    const id = win('C:\\Users\\Quillon', 'Quillon');
    expect(redactIdentity('C:\\Users\\Quillon\\x', id, 'win32')).toBe('<user-home>\\x');
  });
});

describe('idempotence', () => {
  const id = win('C:\\Users\\Quillon', 'Quillon');
  it.each([
    'C:\\Users\\Quillon\\x and Quillon',
    'file:///C:/Users/Quillon/x',
    'C:\\\\Users\\\\Quillon',
    '<user-home> <user> nothing',
  ])('redacting twice equals once: %s', (s) => {
    const once = redactIdentity(s, id, 'win32');
    expect(redactIdentity(once, id, 'win32')).toBe(once);
  });

  it('does not rematch the placeholders even when the name is a word of them', () => {
    for (const name of ['user', 'home', 'user-home', 'userhome']) {
      const v = win('D:\\elsewhere', name);
      const s = `<user-home> <user> C:\\Users\\${name}`;
      const once = redactIdentity(s, v, 'win32');
      expect(redactIdentity(once, v, 'win32')).toBe(once);
      expect(once.startsWith('<user-home> <user> ')).toBe(true);
    }
  });
});

describe('scanner', () => {
  const id = win('C:\\Users\\Quillon', 'Quillon');

  it('finds nothing after redaction', () => {
    const redacted = redactIdentity('a Quillon C:\\Users\\Quillon\\x file:///C:/Users/Quillon/y', id, 'win32');
    expect(findIdentity(redacted, id, 'win32')).toEqual({ found: false, matches: [] });
  });

  it('finds residue when a transformed copy is injected, with locations', () => {
    const redacted = redactIdentity('C:\\Users\\Quillon\\x', id, 'win32');
    const injected = `${redacted} | ${JSON.stringify('C:\\Users\\Quillon\\y').slice(1, -1)}`;
    const finding = findIdentity(injected, id, 'win32');
    expect(finding.found).toBe(true);
    expect(finding.matches[0]?.kind).toBe('home');
    expect(finding.matches[0]?.index).toBe(redacted.length + 3);
  });

  it('messages produced from findings never contain the identity value', () => {
    const finding = findIdentity('xx C:\\Users\\Quillon\\y Quillon', id, 'win32');
    expect(finding.found).toBe(true);
    const message = describeIdentityFinding(finding);
    expect(message.toLowerCase()).not.toContain('quillon');
    expect(message.toLowerCase()).not.toContain('users');
    expect(JSON.stringify(finding).toLowerCase()).not.toContain('quillon');
  });

  it('returns no match for empty identity values', () => {
    const none = identityValuesFromEnv({}, 'win32');
    expect(findIdentity('C:\\Users\\Quillon', none, 'win32').found).toBe(false);
  });
});
