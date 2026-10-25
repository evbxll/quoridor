/** Blocks at most this long are summed with eight interleaved accumulators. */
const BLOCK = 128;

/**
 * Sum of a float64 array with numpy's pairwise summation, bit for bit.
 *
 * Search normalizes priors by this sum, and a different order of additions
 * can change the last bit. numpy sums fewer than 8 values left to right, up to
 * 128 values with eight accumulators combined as a tree, and more by halving
 * (the first half rounded down to a multiple of 8).
 */
export function numpySum(values: ArrayLike<number>): number {
  return pairwise(values, 0, values.length);
}

function pairwise(a: ArrayLike<number>, start: number, n: number): number {
  if (n < 8) {
    let total = 0;
    for (let i = 0; i < n; i++) total += a[start + i]!;
    return total;
  }
  if (n <= BLOCK) {
    const r = Float64Array.from({ length: 8 }, (_, k) => a[start + k]!);
    let i = 8;
    for (; i < n - (n % 8); i += 8) {
      for (let k = 0; k < 8; k++) r[k] = r[k]! + a[start + i + k]!;
    }
    let total = (r[0]! + r[1]! + (r[2]! + r[3]!)) + (r[4]! + r[5]! + (r[6]! + r[7]!));
    for (; i < n; i++) total += a[start + i]!;
    return total;
  }
  let half = Math.floor(n / 2);
  half -= half % 8;
  return pairwise(a, start, half) + pairwise(a, start + half, n - half);
}
