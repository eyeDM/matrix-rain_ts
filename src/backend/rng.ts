const U32_RANGE = 0x1_0000_0000;

const cryptoApi = typeof globalThis.crypto !== 'undefined'
&& typeof globalThis.crypto.getRandomValues === 'function'
    ? globalThis.crypto
    : null;

/**
 * Returns a pseudorandom 32-bit unsigned integer
 * in the full range [0, 0xFFFFFFFF].
 *
 * Not cryptographically secure.
 */
export function rndU32Math(): number {
    return Math.floor(Math.random() * U32_RANGE);
}

/**
 * Returns a cryptographically secure pseudorandom 32-bit unsigned integer
 * in the full range [0, 0xFFFFFFFF].
 *
 * @throws Error if Web Crypto is unavailable.
 */
export function rndU32Crypto(): number {
    if (cryptoApi === null) {
        throw new Error('Cryptographic random generator is unavailable');
    }

    const bytes = new Uint8Array(4);
    cryptoApi.getRandomValues(bytes);

    return new DataView(bytes.buffer).getUint32(0);
}

const rndU32Impl = cryptoApi !== null
    ? rndU32Crypto
    : rndU32Math;

/**
 * Returns a pseudorandom 32-bit unsigned integer
 * in the full range [0, 0xFFFFFFFF].
 *
 * Uses a cryptographically secure generator when available,
 * otherwise falls back to Math.random().
 *
 * Must not be used where cryptographic security is required,
 * because the fallback generator is not cryptographically secure.
 */
export function rndU32(): number {
    return rndU32Impl();
}

/**
 * Deterministic 32-bit pseudo-random number generator (PRNG) based on the
 * Mulberry32 algorithm by Tommy Ettinger.
 *
 * Characteristics:
 * - Very fast (integer arithmetic only)
 * - Suitable for real-time graphics and procedural generation
 * - Deterministic and reproducible for a given seed
 * - Output range: [0, 1)
 *
 * Notes:
 * - Not cryptographically secure.
 * - The period is 2^32.
 *
 * @param seed Unsigned 32-bit integer seed.
 * @returns Next random float.
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
