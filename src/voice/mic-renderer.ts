// TODO(F6): getUserMedia -> PCM chunks -> voice.startTranscription (only when settings.voice).
export function startMic(_onChunk: (pcm: ArrayBuffer) => void): Promise<() => void> {
  throw new Error('not implemented');
}
