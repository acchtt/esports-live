# Riot live-telemetry accuracy investigation

The Aureom and AndyDanger clients use the same Riot-operated LoL Esports endpoint families as this platform. Their reliable behavior comes primarily from frame-selection strategy rather than a different source.

Observed differences addressed by this change:

- Both reference clients select the last frame returned by `window` and `details`.
- The existing provider selected the newest window frame but the first details frame.
- The reference clients request a mature anchor around 60 seconds behind the wall clock, where both feeds are generally available.
- The revised provider uses a mature details anchor with bounded fallbacks, chooses the newest eligible details frame, and aligns the team window to that timestamp when possible.
- Completed-game final frames remain available from Riot after the match and can provide team totals, objectives, player KDA, CS, gold, and items even when persisted event metadata omits game winners or duration.

The reference repositories were reviewed for observable API behavior only. Their GPL source code was not copied.
