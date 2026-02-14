/**
 * Returns a pseudorandom 32-bit unsigned integer
 * in the range [0, 0xFFFFFFFF).
 */
export function rndU32Math(): number {
    return Math.floor(Math.random() * 0xffffffff);
}

/**
 * Returns a cryptographically secure pseudorandom 32-bit unsigned integer
 * in the full range [0, 0xFFFFFFFF].
 */
export function rndU32Crypto(): number {
    return (crypto as any).getRandomValues(new Uint32Array(1))[0];
}

/**
 * Deterministic 32-bit pseudo-random number generator (PRNG) based on the
 * Mulberry32 algorithm by Tommy Ettinger.
 *
 * Characteristics:
 * - Very fast (integer arithmetic only)
 * - Good statistical quality for real-time graphics, procedural generation,
 *   and simulation tasks
 * - Deterministic and reproducible for a given seed
 * - Output range: [0, 1)
 *
 * Notes:
 * - Not cryptographically secure.
 * - The period is 2^32.
 *
 * @param seed Unsigned 32-bit integer seed. Different seeds produce different sequences.
 * @returns Function that returns the next random float in the range [0, 1).
 */
export function mulberry32(seed: number): () => number {
    // Ensure unsigned 32-bit integer
    let state = seed >>> 0;

    return function next(): number {
        // Advance internal state
        state = (state + 0x6D2B79F5) >>> 0;

        // Mix bits (Mulberry32 finalizer)
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

        // Convert to [0, 1) float using unsigned 32-bit normalization
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
