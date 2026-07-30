# External reference review

This project remains a clean-room implementation. External repositories may be reviewed to understand public API behavior and operational failure modes, but their source code, component structure, styles, and naming are not copied.

## AndyDanger/live-lol-esports

Reviewed concepts:

- Riot persisted schedule and event endpoints
- Riot live `window` and `details` endpoints
- 10-second timestamp alignment
- querying behind wall clock when the latest cache key is unavailable
- schedule-to-game navigation and objective-change notifications

Decisions for Esports Live:

- keep API credentials exclusively in the server-side Worker
- use bounded immutable probe plans instead of mutable global delay state
- poll at a controlled client cadence rather than every 500 ms
- classify source freshness independently from request latency
- never infer official outcomes from inhibitors, incomplete series state, or stale telemetry
- keep provider payloads behind the LoL adapter boundary

The reviewed repository is GPL-3.0 licensed. No code from it is incorporated here.