# Grubs CV service

This is the cloud-side proof of concept for filling the LoL `objectives.grubs` field when Riot's public live telemetry omits it.

The service is deliberately split from the Cloudflare API Worker because real broadcast capture needs FFmpeg/OpenCV-style native tooling. The first version already has the stable HTTP contract and FFmpeg frame capture, while the detector is explicitly simulated. A future vision detector can replace `detectGrubs()` without changing the API bridge or ARENA V2.

## HTTP contract

`GET /health`

`GET /v1/grubs/:gameId`

Successful detection:

```json
{
  "schemaVersion": "1.0",
  "gameId": "123",
  "blue": 4,
  "red": 2,
  "confidence": 0.97,
  "observedAt": "2026-08-10T12:00:00.000Z",
  "source": "broadcast-cv",
  "mode": "vision"
}
```

The current detector returns `mode: "simulated"`. The main API rejects simulated values by default.

`POST /v1/capture/:gameId` forces one FFmpeg frame capture and runs the detector seam. This is useful for verifying that a cloud host can reach a real HLS/video URL before the pixel detector is implemented.

## Configuration

- `PORT` — HTTP port, default `8080`.
- `GRUBS_CV_TOKEN` — optional bearer token required by result/capture endpoints.
- `GRUBS_CV_STREAM_URL` — direct HLS/video URL readable by FFmpeg.
- `GRUBS_CV_GAME_ID` — game being sampled by the background loop.
- `GRUBS_CV_CROP` — optional `width:height:x:y` FFmpeg crop, for example `420:120:750:20`.
- `GRUBS_CV_SAMPLE_INTERVAL_MS` — sampling interval, minimum 1000 ms, default 2000 ms.
- `GRUBS_CV_SIM_RESULTS` — JSON map used only by the simulated detector, for example `{"123":{"blue":4,"red":2,"confidence":0.97}}`.

## Container

The Docker image includes Node 24 and FFmpeg. No PC needs to stay online once the image is running on a container-capable cloud host.

```sh
docker build -t grubs-cv services/grubs-cv
docker run --rm -p 8080:8080 \
  -e GRUBS_CV_TOKEN=change-me \
  -e GRUBS_CV_SIM_RESULTS='{"123":{"blue":4,"red":2,"confidence":0.97}}' \
  grubs-cv
```

For a real stream-capture probe, also set `GRUBS_CV_STREAM_URL`, `GRUBS_CV_GAME_ID`, and optionally `GRUBS_CV_CROP`, then call `POST /v1/capture/:gameId`.

## Main API integration

The Cloudflare API Worker accepts these optional variables:

- `GRUBS_CV_URL`
- `GRUBS_CV_TOKEN`
- `GRUBS_CV_MIN_CONFIDENCE` (default `0.9`)
- `GRUBS_CV_ALLOW_SIMULATED` (`1` only for deliberate demo/integration testing)

The wrapper only queries CV when Grubs are missing, preserves any Grubs value already supplied by another source, requires a recent high-confidence result for live/paused games, and fails open to Riot/Leaguepedia data if the CV service is unreachable.
