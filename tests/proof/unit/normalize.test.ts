// Requirements: 13.10, 13.12, 13.13, 13.14, 13.16, 13.18, 13.19, 13.20, 13.21, 13.22, 13.24
import { describe, expect, it } from 'vitest';
import {
  buildRootMatcher,
  normalizeOutcome,
  normalizeText,
  rootForms,
  type SideRoots,
} from '../../../src/proof/core/normalize';
import { redactErrorText, redactOutcome, type PathContext } from '../../../src/proof/core/redact';
import type { EncodedNode, Outcome } from '../../../src/proof/types';

const str = (v: string): EncodedNode => ({ t: 'str', v });
const obj = (props: [string, EncodedNode][]): EncodedNode => ({ t: 'object', ctor: 'Object', props });
const err = (message: string, props: [string, EncodedNode][] = []): EncodedNode => ({
  t: 'error',
  cls: 'Error',
  message,
  props,
});
const returned = (
  value: EncodedNode,
  args: EncodedNode[] = [],
): Extract<Outcome, { kind: 'returned' }> => ({
  kind: 'returned',
  async: false,
  value,
  args,
  prototypeDelta: [],
});
const threw = (value: EncodedNode): Outcome => ({
  kind: 'threw',
  async: false,
  value,
  args: [],
  prototypeDelta: [],
});

const WIN: SideRoots = { created: 'C:\\Users\\x\\AppData\\Local\\Temp\\gs-1\\pkg' };
const POSIX: SideRoots = { created: '/tmp/gs-1/pkg' };

function text(s: string, roots: SideRoots, ci: boolean): string {
  return normalizeText(s, buildRootMatcher(roots, ci));
}

describe('Root_Normalizer: Windows root forms', () => {
  it.each([
    ['native', 'C:\\Users\\x\\AppData\\Local\\Temp\\gs-1\\pkg\\lib\\a.js', '<package>\\lib\\a.js'],
    ['forward slashes, lower case', 'c:/users/x/appdata/local/temp/gs-1/pkg/lib/a.js', '<package>/lib/a.js'],
    ['mixed case', 'c:\\USERS\\X\\AppData\\local\\TEMP\\gs-1\\PKG\\a.js', '<package>\\a.js'],
    ['extended-length', '\\\\?\\C:\\Users\\x\\AppData\\Local\\Temp\\gs-1\\pkg\\a.js', '<package>\\a.js'],
    [
      'escaped back-slash',
      'C:\\\\Users\\\\x\\\\AppData\\\\Local\\\\Temp\\\\gs-1\\\\pkg\\\\a.js',
      '<package>\\\\a.js',
    ],
    ['file URL', 'file:///C:/Users/x/AppData/Local/Temp/gs-1/pkg/a.js', '<package>/a.js'],
  ])('%s', (_name, input, expected) => {
    expect(text(input, WIN, true)).toBe(expected);
  });

  it('replaces the root inside error text and quotes', () => {
    const msg = "Cannot find module 'C:\\Users\\x\\AppData\\Local\\Temp\\gs-1\\pkg\\nope.js' from C:/Users/x/AppData/Local/Temp/gs-1/pkg";
    expect(text(msg, WIN, true)).toBe("Cannot find module '<package>\\nope.js' from <package>");
  });

  it('is case-sensitive when the platform is not Windows', () => {
    expect(text('c:\\users\\x\\appdata\\local\\temp\\gs-1\\pkg\\a.js', WIN, false)).toBe(
      'c:\\users\\x\\appdata\\local\\temp\\gs-1\\pkg\\a.js',
    );
  });
});

describe('Root_Normalizer: percent-encoded file URL', () => {
  const spaced: SideRoots = { created: 'C:\\Users\\x\\AppData\\Local\\Temp\\gs 1\\pkg' };

  it('matches a space as %20 and replaces the whole file:// prefix', () => {
    expect(text('file:///C:/Users/x/AppData/Local/Temp/gs%201/pkg/a.js', spaced, true)).toBe('<package>/a.js');
  });

  it('matches the native form with an unencoded space', () => {
    expect(text('open C:\\Users\\x\\AppData\\Local\\Temp\\gs 1\\pkg\\a.js', spaced, true)).toBe('open <package>\\a.js');
  });

  it('matches hexadecimal digits in either case, also on a case-sensitive platform', () => {
    const root: SideRoots = { created: '/tmp/gs-\u00fcn#%x/pkg' };
    expect(text('file:///tmp/gs-%C3%BCn%23%25x/pkg/a.js', root, false)).toBe('<package>/a.js');
    expect(text('file:///tmp/gs-%c3%bcn%23%25x/pkg/a.js', root, false)).toBe('<package>/a.js');
  });

  it('does not confuse a literal %20 in the root (URL form %2520) with a space', () => {
    const root: SideRoots = { created: '/tmp/gs%20x/pkg' };
    expect(text('/tmp/gs%20x/pkg/a.js', root, false)).toBe('<package>/a.js');
    expect(text('file:///tmp/gs%2520x/pkg/a.js', root, false)).toBe('<package>/a.js');
    // The reverse: a root with a space is not matched by the double-encoded text.
    const spaced: SideRoots = { created: '/tmp/gs x/pkg' };
    expect(text('file:///tmp/gs%2520x/pkg/a.js', spaced, false)).toBe('file:///tmp/gs%2520x/pkg/a.js');
    expect(text('file:///tmp/gs%20x/pkg/a.js', spaced, false)).toBe('<package>/a.js');
  });

  it('builds the URL form by encoding the root', () => {
    const urls = rootForms('C:\\Users\\x\\gs 1\\p#q').filter((f) => f.url).map((f) => f.text);
    expect(urls).toEqual(['file:///C:/Users/x/gs%201/p%23q']);
  });
});

describe('Root_Normalizer: POSIX root forms', () => {
  it.each([
    ['native', '/tmp/gs-1/pkg/lib/a.js', '<package>/lib/a.js'],
    ['file URL', 'file:///tmp/gs-1/pkg/a.js', '<package>/a.js'],
    ['back-slash form', '\\tmp\\gs-1\\pkg\\a.js', '<package>\\a.js'],
  ])('%s', (_name, input, expected) => {
    expect(text(input, POSIX, false)).toBe(expected);
  });

  it('does not match a different letter case', () => {
    expect(text('/TMP/gs-1/pkg/a.js', POSIX, false)).toBe('/TMP/gs-1/pkg/a.js');
  });
});

describe('Root_Normalizer: boundary rule and longest first', () => {
  it.each(['/tmp/gs-1/pkg2/a.js', '/tmp/gs-1/pkg-x/a.js', '/tmp/gs-1/pkg.old/a.js', '/tmp/gs-1/pkg_b', '/tmp/gs-1/pkgé'])(
    'leaves %s unchanged except the e-acute case',
    (input) => {
      const expected = input === '/tmp/gs-1/pkgé' ? '<package>é' : input;
      expect(text(input, POSIX, false)).toBe(expected);
    },
  );

  it('matches at the end of the string and before a character that cannot continue a name', () => {
    expect(text('/tmp/gs-1/pkg', POSIX, false)).toBe('<package>');
    expect(text("'/tmp/gs-1/pkg':3", POSIX, false)).toBe("'<package>':3");
  });

  it('treats the real path as an extra root and keeps the created path', () => {
    const roots: SideRoots = { created: '/link/pkg', real: '/real/target/pkg' };
    expect(text('/link/pkg/a and /real/target/pkg/b', roots, false)).toBe('<package>/a and <package>/b');
  });

  it('prefers the longest form at the same position', () => {
    // The extended-length form contains the native form as a suffix.
    expect(text('\\\\?\\C:\\r\\pkg\\a', { created: 'C:\\r\\pkg' }, true)).toBe('<package>\\a');
  });

  it('does not rescan replaced text and is idempotent', () => {
    const once = text('/tmp/gs-1/pkg/a /tmp/gs-1/pkg', POSIX, false);
    expect(once).toBe('<package>/a <package>');
    expect(text(once, POSIX, false)).toBe(once);
  });

  it('ignores an empty root', () => {
    expect(text('/tmp/x', { created: '' }, false)).toBe('/tmp/x');
  });
});

describe('normalizeOutcome', () => {
  it('replaces the root in values, keys, error text and post-call state, and leaves other paths', () => {
    const outcome: Outcome = {
      kind: 'returned',
      async: false,
      value: obj([
        ['/tmp/gs-1/pkg/lib', str('/tmp/gs-1/pkg/lib/a.js')],
        ['notes', str('/home/x/notes.txt')],
        ['sibling', str('/tmp/gs-1/pkg2/a.js')],
        ['failure', err('bad /tmp/gs-1/pkg/lib/a.js and /home/x/notes.txt', [['path', str('/tmp/gs-1/pkg/b.js')]])],
      ]),
      args: [obj([['f', str('file:///tmp/gs-1/pkg/a.js')]])],
      prototypeDelta: [
        {
          prototype: 'Object.prototype',
          key: { s: '/tmp/gs-1/pkg/k' },
          change: 'added',
          after: { value: str('/tmp/gs-1/pkg/v'), enumerable: true, configurable: true, writable: true },
        },
      ],
    };
    const result = normalizeOutcome(outcome, POSIX, false);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'returned') throw new Error('unexpected');
    expect(result.value.value).toEqual(
      obj([
        ['<package>/lib', str('<package>/lib/a.js')],
        ['failure', err('bad <package>/lib/a.js and /home/x/notes.txt', [['path', str('<package>/b.js')]])],
        ['notes', str('/home/x/notes.txt')],
        ['sibling', str('/tmp/gs-1/pkg2/a.js')],
      ]),
    );
    expect(result.value.args).toEqual([obj([['f', str('<package>/a.js')]])]);
    expect(result.value.prototypeDelta[0]?.key).toEqual({ s: '<package>/k' });
    expect(result.value.prototypeDelta[0]?.after?.value).toEqual(str('<package>/v'));
  });

  it('leaves a non-root absolute path in a thrown message to the Path_Redactor', () => {
    const r = normalizeOutcome(threw(err('open C:\\Users\\x\\notes.txt')), WIN, true);
    expect(r).toEqual({ ok: true, value: threw(err('open C:\\Users\\x\\notes.txt')) });
  });

  it('re-canonicalizes: property order follows the normalized keys', () => {
    const r = normalizeOutcome(returned(obj([['/tmp/gs-1/pkg/z', str('1')], ['m', str('2')]])), POSIX, false);
    if (!r.ok || r.value.kind !== 'returned') throw new Error('unexpected');
    // '<package>/z' sorts before 'm' ('<' is 0x3c, 'm' is 0x6d); the input order was reversed by the sort.
    expect(r.value.value).toEqual(obj([['<package>/z', str('1')], ['m', str('2')]]));
  });

  it('reports normalization-collision when two keys become identical, without a path', () => {
    const r = normalizeOutcome(
      returned(obj([['/tmp/gs-1/pkg/a', str('1')], ['file:///tmp/gs-1/pkg/a', str('2')]])),
      POSIX,
      false,
    );
    expect(r).toEqual({ ok: false, error: { kind: 'normalization-collision', where: 'value' } });
    expect(JSON.stringify(r)).not.toContain('/tmp');
  });

  it('does not report a collision for Map keys, which are values', () => {
    const map: EncodedNode = {
      t: 'map',
      entries: [
        [str('/tmp/gs-1/pkg/a'), str('1')],
        [str('file:///tmp/gs-1/pkg/a'), str('2')],
      ],
    };
    expect(normalizeOutcome(returned(map), POSIX, false).ok).toBe(true);
  });

  it('reports collisions in arguments and in the Prototype_Delta', () => {
    const args = normalizeOutcome(
      returned(str('v'), [obj([['/tmp/gs-1/pkg/a', str('1')], ['\\tmp\\gs-1\\pkg/a', str('2')]])]),
      POSIX,
      false,
    );
    expect(args).toEqual({ ok: false, error: { kind: 'normalization-collision', where: 'args' } });
    const entry = (s: string) => ({
      prototype: 'Object.prototype' as const,
      key: { s },
      change: 'added' as const,
    });
    const delta = normalizeOutcome(
      { ...returned(str('v')), prototypeDelta: [entry('/tmp/gs-1/pkg/k'), entry('file:///tmp/gs-1/pkg/k')] },
      POSIX,
      false,
    );
    expect(delta).toEqual({ ok: false, error: { kind: 'normalization-collision', where: 'prototypeDelta' } });
  });

  it('compares equal after normalization when two sides return the same string from different roots', () => {
    const a = normalizeOutcome(returned(str('/tmp/gs-1/pkg/lib/a.js')), { created: '/tmp/gs-1/pkg' }, false);
    const b = normalizeOutcome(returned(str('/tmp/gs-2/res/lib/a.js')), { created: '/tmp/gs-2/res' }, false);
    expect(a).toEqual(b);
    const wa = normalizeOutcome(returned(err('x C:\\a\\orig\\lib')), { created: 'C:\\a\\orig' }, true);
    const wb = normalizeOutcome(returned(err('x c:\\B\\RES\\lib')), { created: 'C:\\b\\res' }, true);
    expect(wa).toEqual(wb);
  });

  it('applies only the side\u2019s own roots', () => {
    const own = normalizeOutcome(returned(str('/tmp/gs-2/res/a')), { created: '/tmp/gs-1/pkg' }, false);
    expect(own).toEqual({ ok: true, value: returned(str('/tmp/gs-2/res/a')) });
  });

  it('is idempotent and passes crash and timeout outcomes through', () => {
    const o = returned(obj([['/tmp/gs-1/pkg/a', str('/tmp/gs-1/pkg/b')]]));
    const once = normalizeOutcome(o, POSIX, false);
    if (!once.ok) throw new Error('unexpected');
    expect(normalizeOutcome(once.value, POSIX, false)).toEqual(once);
    expect(normalizeOutcome({ kind: 'crash' }, POSIX, false)).toEqual({ ok: true, value: { kind: 'crash' } });
    expect(normalizeOutcome({ kind: 'timeout' }, POSIX, false)).toEqual({ ok: true, value: { kind: 'timeout' } });
  });
});

describe('Path_Redactor', () => {
  const winCtx: PathContext = {
    caseInsensitive: true,
    knownPaths: {
      work: 'C:\\Users\\x\\AppData\\Local\\Temp\\gs-1',
      tmpDir: 'C:\\Users\\x\\AppData\\Local\\Temp',
      nodeDir: 'C:\\Program Files\\nodejs',
      tempNames: ['gs-1', 'side-orig'],
    },
    identityPaths: ['C:\\Users\\x'],
  };
  const posixCtx: PathContext = {
    caseInsensitive: false,
    knownPaths: { work: '/tmp/gs-1', tmpDir: '/tmp', nodeDir: '/usr/local/lib/node', tempNames: ['gs-1'] },
    identityPaths: ['/home/x'],
  };
  const noIdentity = (c: PathContext): PathContext => ({ ...c, identityPaths: [] });

  it.each([
    ["open 'C:\\Users\\y\\notes.txt'", "open '<redacted-path>'"],
    ['open c:/users/y/notes.txt now', 'open <redacted-path> now'],
    ['at \\\\?\\C:\\Users\\y\\pkg\\a.js', 'at <redacted-path>'],
    ['at \\\\?\\UNC\\server\\share\\a.js', 'at <redacted-path>'],
    ['from \\\\server\\share\\pkg\\a.js', 'from <redacted-path>'],
    ['at file:///C:/Users/y/pkg/a.js', 'at <redacted-path>'],
    ['at file:///C:/Users/y/my%20dir/a.js', 'at <redacted-path>'],
    ["JSON C:\\\\Users\\\\y\\\\a.js", 'JSON <redacted-path>'],
  ])('redacts other absolute paths (Windows): %s', (input, expected) => {
    expect(redactErrorText(input, noIdentity(winCtx))).toBe(expected);
  });

  it.each([
    ["open '/home/y/notes.txt'", "open '<redacted-path>'"],
    ['at file:///home/y/pkg/a.js', 'at <redacted-path>'],
    ['at fn (/opt/app/a.js:10:5)', 'at fn (<redacted-path>:10:5)'],
    ['see /usr/lib/x, then stop', 'see <redacted-path>, then stop'],
  ])('redacts other absolute paths (POSIX): %s', (input, expected) => {
    expect(redactErrorText(input, noIdentity(posixCtx))).toBe(expected);
  });

  it('leaves relative paths, URLs and fractions alone', () => {
    const t = 'see ./lib/a.js, ../b, lib/c.js, https://example.com/x and 1/2 and/or a / b';
    expect(redactErrorText(t, winCtx)).toBe(t);
  });

  it('rewrites the remainder of a <package> path with forward slashes and does not redact it', () => {
    expect(redactErrorText("Cannot find '<package>\\lib\\a.js:3:4' in <package>", winCtx)).toBe(
      "Cannot find '<package>/lib/a.js:3:4' in <package>",
    );
    expect(redactErrorText('<package>\\\\lib\\\\a.js', winCtx)).toBe('<package>/lib/a.js');
    expect(redactErrorText('<package>/lib/a.js', posixCtx)).toBe('<package>/lib/a.js');
  });

  it('replaces the work root, os.tmpdir() and the Node directory with the rest of their path, also under an identity path', () => {
    expect(redactErrorText('x C:\\Users\\x\\AppData\\Local\\Temp\\gs-1\\orig\\a.js y', winCtx)).toBe('x <redacted-path> y');
    expect(redactErrorText('x C:\\Users\\x\\AppData\\Local\\Temp\\other.txt y', winCtx)).toBe('x <redacted-path> y');
    expect(redactErrorText('x file:///C:/Users/x/AppData/Local/Temp/gs-1/a y', winCtx)).toBe('x <redacted-path> y');
    expect(redactErrorText("x 'C:\\Program Files\\nodejs\\node_modules\\npm' y", winCtx)).toBe("x '<redacted-path>' y");
    expect(redactErrorText('x /tmp/gs-1/orig/a.js y', posixCtx)).toBe('x <redacted-path> y');
    expect(redactErrorText('x /usr/local/lib/node/lib/a.js y', posixCtx)).toBe('x <redacted-path> y');
  });

  it('handles the longest known root first (work root under tmpdir)', () => {
    expect(redactErrorText('/tmp/gs-1/orig/a.js and /tmp/b.js', posixCtx)).toBe('<redacted-path> and <redacted-path>');
  });

  it('matches known roots and drive letters case-insensitively only on Windows', () => {
    expect(redactErrorText('c:\\users\\x\\appdata\\local\\temp\\GS-1\\a', winCtx)).toBe('<redacted-path>');
    expect(redactErrorText('/TMP/gs-1/a', { ...posixCtx, identityPaths: [] })).toBe('<redacted-path>');
  });

  it('leaves a path that begins with an Identity_Value path for the identity step', () => {
    expect(redactErrorText("open 'C:\\Users\\x\\notes.txt'", winCtx)).toBe("open 'C:\\Users\\x\\notes.txt'");
    expect(redactErrorText('open c:/users/X/notes.txt', winCtx)).toBe('open c:/users/X/notes.txt');
    expect(redactErrorText('at file:///C:/Users/x/pkg/a.js', winCtx)).toBe('at file:///C:/Users/x/pkg/a.js');
    expect(redactErrorText('open /home/x/notes.txt', posixCtx)).toBe('open /home/x/notes.txt');
    // A sibling user directory is not under the identity path.
    expect(redactErrorText('open C:\\Users\\xy\\notes.txt', winCtx)).toBe('open <redacted-path>');
  });

  it('replaces temporary directory names that appear without a parent path', () => {
    expect(redactErrorText('rm gs-1 and side-orig failed', winCtx)).toBe('rm <redacted-path> and <redacted-path> failed');
    expect(redactErrorText('gs-10 and xgs-1 stay', winCtx)).toBe('gs-10 and xgs-1 stay');
  });

  it('is idempotent', () => {
    const t = "a <package>\\x C:\\Users\\y\\z 'gs-1' /home/q file:///tmp/gs-1/a \\\\h\\s\\t";
    const once = redactErrorText(t, winCtx);
    expect(redactErrorText(once, winCtx)).toBe(once);
  });

  it('gives the same text for two sides whose texts differ only in their package roots', () => {
    const a = text('failed at C:\\a\\orig\\lib\\x.js:1:2 near C:\\Users\\y\\q.txt', { created: 'C:\\a\\orig' }, true);
    const b = text('failed at C:\\b\\res\\lib\\x.js:1:2 near C:\\Users\\y\\q.txt', { created: 'C:\\b\\res' }, true);
    expect(redactErrorText(a, winCtx)).toBe(redactErrorText(b, winCtx));
    expect(redactErrorText(a, winCtx)).toBe('failed at <package>/lib/x.js:1:2 near <redacted-path>');
  });
});

describe('redactOutcome: error text only', () => {
  const ctx: PathContext = {
    caseInsensitive: true,
    knownPaths: { work: 'C:\\w\\gs-1', tmpDir: 'C:\\t', nodeDir: 'C:\\n', tempNames: [] },
    identityPaths: [],
  };

  it('redacts error message, string properties and thrown strings, and nothing else', () => {
    const other = 'C:\\Users\\x\\notes.txt';
    const o = redactOutcome(
      returned(
        obj([
          ['plain', str(other)],
          ['e', err(`bad ${other}`, [['path', str(other)], ['n', { t: 'num', v: 1 }]])],
        ]),
        [str(other)],
      ),
      ctx,
    );
    expect(o).toEqual(
      returned(
        obj([
          ['e', err('bad <redacted-path>', [['n', { t: 'num', v: 1 }], ['path', str('<redacted-path>')]])],
          ['plain', str(other)],
        ]),
        [str(other)],
      ),
    );
    expect(redactOutcome(threw(str(`oops ${other}`)), ctx)).toEqual(threw(str('oops <redacted-path>')));
    expect(redactOutcome(returned(str(other)), ctx)).toEqual(returned(str(other)));
  });

  it('does not touch keys or the Prototype_Delta', () => {
    const other = 'C:\\Users\\x\\notes.txt';
    const o: Outcome = {
      ...returned(obj([[other, str('v')]])),
      prototypeDelta: [{ prototype: 'Object.prototype', key: { s: other }, change: 'added' }],
    };
    expect(redactOutcome(o, ctx)).toEqual(o);
  });
});
