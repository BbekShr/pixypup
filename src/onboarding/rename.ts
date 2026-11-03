import '../ui/tokens.css';
import './onboarding.css';

declare global {
  interface Window {
    pixyRename: { info(): Promise<unknown>; save(name: string): Promise<unknown>; close(): void };
  }
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const nameEl = $<HTMLInputElement>('name');
const save = $<HTMLButtonElement>('save');
const msg = $('msg');
let current = '';

// Mirrors checkPetName in main, which has the final say.
const clean = (): string => nameEl.value.trim();
const ready = (): boolean => { const n = clean(); return n.length >= 1 && n.length <= 24 && n !== current && ![...n].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127); };

void window.pixyRename.info().then((i) => {
  const { name, original, avatar } = (i ?? {}) as { name?: string; original?: string; avatar?: string | null };
  current = name ?? '';
  $('title').textContent = `A new name for ${current || 'your pet'}?`;
  nameEl.value = current;
  nameEl.placeholder = original ?? '';
  if (avatar) { $<HTMLImageElement>('face').src = avatar; $('face').hidden = false; }
  nameEl.focus();
  nameEl.select();
});

nameEl.addEventListener('input', () => { save.disabled = !ready(); msg.textContent = ''; });
nameEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && ready()) save.click();
  if (e.key === 'Escape') window.pixyRename.close();
});
save.addEventListener('click', () => {
  save.disabled = true;
  void window.pixyRename.save(clean()).then((r) => {
    if (r === 'ok') {
      $('title').textContent = `Hi, ${clean()}!`;
      setTimeout(() => window.pixyRename.close(), 900);
      return;
    }
    msg.textContent = "That name didn't stick. Try 1 to 24 letters?";
    save.disabled = !ready();
  });
});
for (const id of ['later', 'close']) $(id).addEventListener('click', () => window.pixyRename.close());
