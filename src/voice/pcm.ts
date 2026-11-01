/** Mono float32 [-1,1] at inputRate -> 16-bit PCM at 24 kHz (box-average when downsampling, linear when up). */
export function downsampleTo24k(float32: Float32Array, inputRate: number): Int16Array {
  const ratio = inputRate / 24000;
  const out = new Int16Array(Math.floor(float32.length / ratio));
  for (let i = 0; i < out.length; i++) {
    let v: number;
    if (ratio > 1) {
      const a = Math.floor(i * ratio);
      const b = Math.max(a + 1, Math.min(float32.length, Math.floor((i + 1) * ratio)));
      let s = 0;
      for (let j = a; j < b; j++) s += float32[j];
      v = s / (b - a);
    } else {
      const p = i * ratio;
      const a = Math.floor(p);
      v = float32[a] + ((float32[Math.min(a + 1, float32.length - 1)] - float32[a]) * (p - a));
    }
    out[i] = Math.round(Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767));
  }
  return out;
}
