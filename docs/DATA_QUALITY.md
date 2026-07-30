# Data quality policy

Live status and telemetry quality are separate facts.

A broadcast or series may be live while telemetry is unavailable, incomplete, stale, or not advancing. The platform must preserve that distinction.

## Default freshness classes

| Source age | Class | Live-analysis safety |
|---|---|---|
| 0–30 seconds | `fresh` | Eligible only when complete and advancing |
| 31–90 seconds | `degraded` | Context only |
| Over 90 seconds | `stale` | Historical context only |
| Missing or invalid time | `unavailable` | Unsafe |

## Safety decision

`safeForLiveAnalysis` is true only when all conditions hold:

- source timestamp is valid
- freshness is `fresh`
- betting-critical fields are complete
- telemetry is not explicitly non-advancing

Adapters may add stricter completeness requirements for their esport. They may not weaken the shared freshness boundary without an explicit, reviewed policy change.

## Presentation rules

- Never describe unavailable telemetry as draft, paused, or completed without evidence.
- Never infer a winner or official score from incomplete telemetry.
- Display source age and quality reasons alongside non-fresh context.
- Provider request latency must not be labeled as source age.
- Cached data must retain the original source timestamp.
