# Feature

## Method
1. **Restate the acceptance criteria** from the item. Each one maps to a test or a verifiable
   check before you write code. A criterion you can't test goes back to the CEO.
2. **Find the existing pattern**: the closest existing feature is the template. Reuse its helpers,
   structure, and naming. New infrastructure needs a reason in the report.
3. **Smallest version that meets the criteria.** No speculative options, flags, or abstractions.
4. **Build and test together**, one criterion at a time.
5. **Verify it for real** with `/pixypup-verify`: run the feature the way a user would, at
   every required viewport or environment. Attach the evidence.
6. Docs, if the feature is user-visible and the project documents features.

## In this project
- Features live by layer under `src/<area>/` (main, overlay, onboarding, voice, api, screen). The closest reference features: `src/api/sam.ts` (API call + pure parsing + tests), `src/screen/decide.ts` (`ruleDecide`, pure + tested), `src/overlay/state.ts`.
- Definition of done: gates green AND seen working in `npm run dev` via `/pixypup-verify`, AND with `screenAware: false, voice: false` the feature makes no network call.
- Contracts change in pairs: `contracts/*.schema.json` and `contracts/types.ts` together.
- User-visible features get a line in `README.md`; anything touching data handling updates `docs/ENTERPRISE.md` (protected: name it in the PR).
- Deadline rule: build the version the demo needs. Teach-a-trick and break reminders are stretch, not scope.
