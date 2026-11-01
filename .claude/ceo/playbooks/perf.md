# Perf

## Method
1. **Measure before touching anything.** A perf claim without a number is a guess. Use the
   inspection tools in `/pixypup-verify`: a trace, a profile, timings over N runs (report the
   median and spread), bundle size, query count.
2. **Find the dominant cost** in the measurement. Fix that, not what looks slow in the code.
3. **One change at a time**, re-measuring after each.
4. **Prove it held:** same measurement, same conditions, before and after, in the report. A change
   that doesn't move the number gets reverted, however elegant it is.
5. **Guard it** where cheap: a budget, a query-count assertion, a size limit, so it can't regress
   silently.

## In this project
- Measure the overlay with CDP `Performance.getMetrics` (JSHeapUsedSize, TaskDuration) over 10 s of walking, before and after.
- Measure API cost by counting calls per minute of the screen loop (log the count, never the payload). Budget: SAM only when the terminal crop hash changes; Zoom/Meet and Slack paths make zero API calls.
- Pose pipeline budget: photo → pet in about 60-90 s; time each stage (`scripts/pose-test.ts` prints per-stage ms).
- Never measure against anything but the local dev build.
