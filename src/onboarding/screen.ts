import '../ui/tokens.css';
import './onboarding.css';
import sitUrl from '../../assets/pets/Pakkun/sit.png';

declare global {
  interface Window {
    pixyScreen: { answer(yes: boolean): void };
  }
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const name = new URLSearchParams(location.search).get('name') || 'Your pet';
$('hero').setAttribute('src', sitUrl);
if (new URLSearchParams(location.search).get('kind') === 'voice') {
  $('title').textContent = `Let ${name} hear you?`;
  $('what').textContent = `Press ⌥ Space and say "${name}, sit". ${name} listens for a few seconds after you press, and stops on its own.`;
  $('reads').textContent = `The audio goes to Meta's speech model just for that moment. Nothing is saved.`;
  $('mac').textContent = 'macOS will ask once for the microphone.';
} else {
  $('title').textContent = `Let ${name} notice things?`;
  $('what').textContent = `${name} can notice a failing test, a new notification badge in your Dock or a video call.`;
  $('reads').textContent = `${name} reads only your front Terminal's text and the list of open windows. Nothing is saved; the error line is sent to Meta's model only to write the speech bubble. If you click ${name} for a hint, the failure's lines go to Meta's model once to write it.`;
}
$('yes').addEventListener('click', () => window.pixyScreen.answer(true));
for (const id of ['no', 'close']) $(id).addEventListener('click', () => window.pixyScreen.answer(false));
