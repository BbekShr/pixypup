import '../ui/tokens.css';
import './onboarding.css';
import sitUrl from '../../assets/pets/Pakkun/sit.png';

declare global {
  interface Window {
    pixyKey: { info(): Promise<unknown>; save(key: string): Promise<unknown>; openKeyPage(): void; close(): void };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const keyEl = $<HTMLInputElement>('key');
const save = $<HTMLButtonElement>('save');
const msg = $('msg');
const SAY: Record<string, string> = {
  'bad-key': "Hmm, Meta didn't take that key. Want to try another?",
  network: "I couldn't reach Meta to check it. Try again in a moment?",
  unsafe: "I couldn't store that safely on this Mac, so I didn't keep it.",
};

$('hero').setAttribute('src', sitUrl);
void window.pixyKey.info().then((i) => {
  const { name, hasKey } = (i ?? {}) as { name?: string; hasKey?: boolean };
  const n = name || 'Your pet';
  $('what').textContent = `With your Meta API key, ${n} talks back in their own words, explains a failing test when you click them, hears "${n}, sit", and you can turn a photo into a new pet.`;
  if (hasKey) {
    $('title').textContent = 'Your Meta key';
    keyEl.placeholder = 'Paste a new key to replace it';
    save.textContent = 'Replace key';
  }
});

const ready = (): boolean => /^[\x21-\x7e]{8,512}$/.test(keyEl.value.trim());
keyEl.addEventListener('input', () => { save.disabled = !ready(); msg.textContent = ''; });
keyEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && ready()) save.click(); });
save.addEventListener('click', () => {
  save.disabled = true;
  msg.textContent = '';
  save.textContent = 'Checking…';
  void window.pixyKey.save(keyEl.value.trim()).then((r) => {
    if (r === 'ok') {
      keyEl.value = ''; // the key now lives in main only
      $('title').textContent = 'All set!';
      $('what').textContent = 'Your key works. Everything is unlocked.';
      setTimeout(() => window.pixyKey.close(), 1400);
      return;
    }
    msg.textContent = SAY[String(r)] ?? SAY['bad-key']!;
    save.textContent = 'Save key';
    save.disabled = !ready();
  });
});
$('getkey').addEventListener('click', () => window.pixyKey.openKeyPage());
for (const id of ['later', 'close']) $(id).addEventListener('click', () => window.pixyKey.close());
