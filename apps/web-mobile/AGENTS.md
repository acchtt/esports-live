# Mobile application boundary

This directory owns the mobile-only web application.

- Keep mobile navigation, scoreboard markup, mobile CSS, and mobile DOM selectors under `apps/web-mobile`.
- Do not modify `apps/web` for mobile layout work.
- `apps/web` is the desktop application and deploys independently.
- Shared API contracts and Riot normalization belong in `packages`.
- Shared Worker behavior belongs in `apps/api` and must not be copied into either web application.
- Mobile deployments must build `@esports-live/web-mobile` and publish `apps/web-mobile/dist`.
- Report the mobile preview run number and short commit SHA after every deployment-related update.
