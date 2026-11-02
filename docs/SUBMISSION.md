# Submission form answers

Portal: https://cerebralvalley.ai/e/meta-ai-developer-hackathon/hackathon/submit. Due Wed Nov 4, 8:00 PM CT.

**Which track are you submitting to?** Indie Developer Track

**Which problem statement did you build towards?** Build for Your World

**Most Viral Track (X post link):** optional. Post the video on X with the repo link before submitting, then paste the post URL here.

**Public GitHub Repository:** https://github.com/BbekShr/pixypup

**3-Minute Demo Video:** YouTube link. Upload as Unlisted (or Public, if you want views for the viral award), and check that it plays while logged out.

---

## Project Description

I spend my workdays alone with a screen, deep in terminals and dense docs. My dog Pakkun is who gets me through it, but he can't sit at my desk. Desktop pets already exist, but they are stock characters, and none of them can see what you're doing, so they're decoration rather than company.

PixyPup turns one photo of your own dog or cat into a companion that lives on your Mac. Drop in a photo, and a few minutes later your pet trots along the bottom of your screen, on a click-through layer that never steals your focus. Pet it and it wiggles; click it and it sits, barks or rolls over; leave it alone and it naps.

It also keeps an eye on your work with you. When a test fails in your terminal, your pet runs to the red line, sniffs it and barks. Click it for a hint about why the test failed, and when you fix it, it cheers. It perks up at new Slack or Mail badges, hides at the screen edge when you join a call, and does tricks on voice command ("Pakkun, sit").

Privacy is the default: screen and voice awareness are off until you turn them on, and with them off PixyPup makes no network calls at all. It ships as a macOS DMG (Apple Silicon), and you can try it in the browser at https://bbekshr.github.io/pixypup/.

## Describe your use of Meta products to build the submitted project

PixyPup chains five Meta models through the Meta Model API:

- **SAM 3.1** (`sam-3.1`) cuts the pet out of the user's photo, then cleans up every generated pose so each sprite has a crisp transparent edge.
- **Muse Image** (`muse-image-1.0`) draws a consistent set of 3D-style poses from that single photo (stand, sit, sleep, bark, roll and others), plus three candidate 8-frame walk cycles.
- **Muse Wonder** (`muse-wonder-1.0`) is used as a judge: it reviews every drawn pose against the photo (same pet, right pose, one tail) and sends failures back to Muse Image with its notes, then watches the drawn walk cycles and picks the most natural, even one. This step needs no human review.
- **Muse Spark 1.3** (`muse-spark-1.3`) is the pet's brain. It reads the failing test line (passed as quoted data, never as instructions), decides how to react, writes the speech bubble in the pet's voice, and explains what probably broke when you click for a hint. It also powers "Talk to Pakkun", a desk-buddy chat.
- **Voice Transcribe** (`muse-voice-transcribe-1.0`) turns "Pakkun, sit" into a trick, and only listens while you hold ⌥ Space.

Everything around the models is local: an Electron overlay, a Swift helper that reads window and Dock state, a stride-matched sprite animator, and rule-based fallbacks so the pet still reacts with no network connection. The repo has 675 automated tests.

## Why are Meta's models important to your solution?

Without them, the product can't exist. Turning one casual phone photo into a full, consistent set of animated poses of *your* pet used to need an illustrator or a 3D artist. SAM 3.1 and Muse Image do it in a few minutes, and Muse Wonder handles the quality check that would otherwise need a human: catching a wrong pose or a second tail, and choosing which walk cycle looks alive.

Muse Spark is what turns a cute sprite into a companion. It understands what's on screen well enough to tell a failing test from noise, reacts in character, and gives a useful hint about the bug. Fast, low-cost calls keep the reactions feeling live, and Voice Transcribe makes talking to your pet natural.

Together, the models make a desktop pet that is personal (your own animal), aware (it sees your work), and useful (it helps you notice and fix things). None of those three was possible for a desktop pet before.

**Partner technologies feedback (Fireworks, Modal, Baseten):** optional. We didn't use them, so leave it blank or write "Not used; everything ran on the Meta Model API."

---

**Survey questions (likelihood, opinion, recommend):** these are your own opinions, so answer them yourself.

**Consent checkbox:** required. It grants Meta and Cerebral Valley the right to use the project in marketing, which the Official Rules already include.
