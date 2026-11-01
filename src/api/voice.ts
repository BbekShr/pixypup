// TODO(F6): streaming transcription.
export function startTranscription(
  _onTranscript: (t: { text: string; final: boolean }) => void,
): Promise<{ push(pcm: ArrayBuffer): void; end(): void }> {
  throw new Error('not implemented');
}
