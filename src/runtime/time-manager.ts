/**
 * TimeManager: Centralized time state management for frame-rate independent animation.
 *
 * Responsibilities:
 * - Accumulate frame delta time (dt) across the application lifecycle
 * - Provide numerically stable periodic time for shader-based animations
 * - Guarantee bounded time values to prevent floating-point precision loss
 * - Enable future pause/resume/reset functionality
 *
 * Design Rationale:
 * - GPU shaders use f32 precision, which degrades significantly beyond ~16.7M
 * - All shader time usage is periodic (sin, hash functions with fract(), phase offsets)
 * - Wrapping time to [0, period) maintains semantic correctness while ensuring precision
 * - Separation of concerns: time management isolated from render loop and uniform buffers
 *
 * Numerical Stability Guarantees:
 * - Periodic time is always in range [0, period), preventing unbounded growth
 * - Default period of 2π optimizes for trigonometric shader operations
 * - Elapsed time tracked separately for metrics without polluting shader inputs
 *
 * Corner Cases Handled:
 * - dt = 0 (first frame): No state corruption
 * - Negative dt: Clamped to 0 to prevent time reversal
 * - NaN/Infinity dt: Validated and rejected with warning
 * - Modulo wrapping: Uses fmod-style behavior for smooth continuity
 *
 * Usage Example:
 * ```typescript
 * const timeManager = new TimeManager();
 *
 * function onFrame(dt: number): void {
 *   timeManager.tick(dt);
 *   const periodicTime = timeManager.getPeriodic(); // Always < 2π
 *   shader.updateUniform({ time: periodicTime });
 * }
 * ```
 */

const TWO_PI = 2.0 * Math.PI;

/**
 * Centralized time management for GPU-driven animations.
 *
 * Maintains two time counters:
 * 1. `elapsed`: Unbounded, monotonically increasing (for debugging/metrics)
 * 2. `periodic`: Wrapped to [0, period) for shader consumption
 */
export class TimeManager {
    /**
     * Unbounded elapsed time in seconds since initialization.
     * Used for metrics, debugging, and logging only.
     * WARNING: This value WILL lose precision after extended runtime.
     */
    private elapsed: number = 0.0;

    /**
     * Periodic time in seconds, wrapped to [0, period).
     * This is the CANONICAL time value for all shader uniforms.
     * Guaranteed to maintain f32 precision indefinitely.
     */
    private periodic: number = 0.0;

    /**
     * The wrapping period for periodic time (in seconds).
     * Default: 2π (~6.28s) for optimal trigonometric shader operations.
     */
    private readonly period: number;

    /**
     * Create a new TimeManager.
     *
     * @param period - The wrapping period for periodic time (default: 2π).
     *                 Must be positive and finite.
     */
    constructor(period: number = TWO_PI) {
        if (!Number.isFinite(period) || period <= 0) {
            throw new Error(
                `TimeManager: period must be positive and finite, got ${period}`
            );
        }
        this.period = period;
    }

    /**
     * Advance time by the given delta.
     *
     * This method should be called exactly once per frame with the frame's dt.
     *
     * @param dt - Frame delta time in seconds (must be non-negative and finite)
     */
    tick(dt: number): void {
        // Validate dt to prevent NaN/Infinity propagation
        if (!Number.isFinite(dt)) {
            // eslint-disable-next-line no-console
            console.warn(`TimeManager.tick: Invalid dt (${dt}), skipping frame`);
            return;
        }

        // Clamp negative dt to 0 (prevent time reversal)
        const safeDt = Math.max(0.0, dt);

        // Update elapsed time (unbounded, for metrics only)
        this.elapsed += safeDt;

        // Update periodic time with modulo wrapping
        this.periodic = (this.periodic + safeDt) % this.period;

        // Ensure periodic time is strictly within [0, period)
        // Handle edge case where modulo might produce period due to floating-point error
        if (this.periodic >= this.period) {
            this.periodic = 0.0;
        }
    }

    /**
     * Get the current periodic time, guaranteed to be in range [0, period).
     *
     * This is the PRIMARY time value to use for all shader uniforms.
     * It maintains optimal f32 precision indefinitely.
     *
     * @returns Periodic time in seconds, always in [0, period)
     */
    getPeriodic(): number {
        return this.periodic;
    }

    /**
     * Get the unbounded elapsed time since initialization.
     *
     * WARNING: This value is for debugging/metrics ONLY.
     * Do NOT use this for shader uniforms - precision degrades over time.
     *
     * @returns Elapsed time in seconds (unbounded, loses precision after ~24h)
     */
    getElapsed(): number {
        return this.elapsed;
    }

    /**
     * Get the configured wrapping period.
     *
     * @returns The period in seconds
     */
    getPeriod(): number {
        return this.period;
    }

    /**
     * Reset time state to zero.
     *
     * This is useful for:
     * - Testing/debugging
     * - Pause/resume functionality
     * - Resetting application state
     */
    reset(): void {
        this.elapsed = 0.0;
        this.periodic = 0.0;
    }
}
