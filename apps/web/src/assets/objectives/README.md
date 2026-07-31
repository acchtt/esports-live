# Objective assets

Riot scoreboard/broadcast objective glyphs sourced through CommunityDragon. Tower, dragon, Baron, and inhibitor are isolated from their actual connected-component bounds in `scoreboardatlas.png`, rather than assumed 64-pixel cells; Rift Herald uses Riot's `_riftherald.png`. Vite imports these files into the production asset graph so every reference is build-managed and cache-safe.
