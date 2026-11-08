# Builders with Taste

This is the live brick-building workshop for roughly 200 participants. Use [README.md](README.md) for local setup, rehearsal, deployment, and recovery. The participant app, facilitator dashboard, and projection screen share the same React/TypeScript frontend.

## Working locally

- Use Node 24 and `npm ci`. Run `npm run dev:api` and `npm run dev` in separate terminals. Create a disposable local room with `npm run session -- 'Local rehearsal'` after the API is ready.
- Run `npm test` and `npm run build` after code changes. For changes to joining, phase control, media, or reset, check the affected phone, facilitator, and projection views together in a test room. Run `npm run load` locally for changes to concurrency or throughput.
- `src/main.tsx` owns routing and the participant and facilitator flows. `src/client.ts` handles connection, drafts, and pending saves. `src/stage.tsx` and `src/stage-data.ts` handle projection. `server/app.ts`, `server/model.ts`, and `server/schema.sql` handle the API, shared state, and persistence.

## Workshop behavior

- The facilitator controls phase changes. Participants choose an AI app and take the photo and prompt to that app. Keep both **Take a photo** and **Choose from camera roll** available wherever a photo can be added or replaced.
- The projection shows room totals and builds that participants chose to share. Keep the participant roster and AI choices facilitator-only. Private notes and brick-pile photos stay on the phone.
- Preserve existing drafts, consent, and safe retries during disconnections. A confirmed reset starts an empty run with the same room code and staff links. Reject writes from the prior run, including pending saves that arrive after a reset.

## Live operations

- GitHub Actions deploys `main` to [brick.btrbot.com](https://brick.btrbot.com/). The API deploys separately on Hugin. Connect with `ssh hugin` and work only in this app's Compose project. Use a compatible API release before publishing frontend changes that depend on it.
- Use disposable rooms for synthetic joins, uploads, resets, and load tests. Resetting or closing an existing workshop room requires an explicit request for that room. Preserve matching database and photo backups before backend migrations. After a reset, any rollback must preserve run isolation or restore a matching pre-migration backup.
- Keep private staff links, tokens, room exports, photos, and backups in ignored local storage or on Hugin. The repository is public. Share only the participant join URL via the QR code. See the rehearsal instructions for locating the private links.
