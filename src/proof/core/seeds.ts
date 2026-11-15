/**
 * Deterministic seed derivation for Proof of Life (Requirement 8.5).
 *
 * Algorithm: FNV-1a, 32 bit, over the UTF-8 bytes of
 * `${seed}\0${parts.join('\0')}`. For each byte: hash ^= byte, then
 * hash = hash * 16777619 (mod 2^32, via Math.imul), starting from the offset
 * basis 2166136261. The result is returned as a signed int32 (`| 0`).
 *
 * The result depends only on the arguments. It reads no clock, environment or
 * random source, and it does not depend on the order in which other functions
 * or cases were derived, so a shrunk case and a replay see the same seed.
 * Lone surrogates encode as U+FFFD, which TextEncoder defines deterministically.
 */

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

const encoder = new TextEncoder();

export function deriveSeed(seed: number, ...parts: readonly string[]): number {
  const bytes = encoder.encode(`${seed}\0${parts.join('\0')}`);
  let hash = FNV_OFFSET_BASIS;
  for (const byte of bytes) {
    hash = Math.imul(hash ^ byte, FNV_PRIME);
  }
  return hash | 0;
}
