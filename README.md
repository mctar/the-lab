# The Lab

A mobile workshop app with facilitator-controlled phases and a live projection screen. Frontend: React/TypeScript on GitHub Pages. Backend: Fastify, PostgreSQL, and private image storage on Hugin.

Running a workshop? See [The Lab facilitator guide](FACILITATOR-GUIDE.md).

Participants scan the lobby QR, choose their AI app, and join on one screen. They photograph their loose bricks, send the photo and today’s prompt to their own AI, and try its plan. The facilitator opens a separate build-photo step before reflection. Participants then develop the idea in the same AI chat and can share a short concept card. They can vote during the final reflection. Written reflection notes and loose-brick photos stay on the phone. The stage shows shared builds, room totals, and aggregate responses.

The facilitator dashboard keeps the current cue, timer, stage switches, next action, and room progress on one laptop screen. **Participant details** opens the searchable anonymous roster with current screen, time there, last activity, queued saves, and checkpoints. Phones report minimal activity metadata about every 25–30 seconds and after screen/save changes. They show a matching Builder reference for troubleshooting. Host-only reports contain photo-readiness flags. Background activity is labelled separately, and older clients show their last saved screen until refreshed.

Every photo control has separate **Take a photo** and **Choose from camera roll** options, including when replacing a picture. The camera control requests the rear camera; the library control leaves the operating system's image picker available. Both paths use the same compression, private draft storage, and display consent rules.

## Working in Codex

Open this repository as a local Codex project. On the workshop Mac it is saved as **The Build**. [AGENTS.md](AGENTS.md) gives new chats the workshop rules, code map, and production boundaries. Keep this README as the reference for running the app and rehearsing a session.

For a new worktree, use Node 24 and `npm ci` for setup. Start the API and web app in separate terminals using the commands below. Both use fixed local ports, so stop them before starting the app from another checkout. Each checkout gets its own `.runtime/` directory and local rooms.

To add desktop shortcuts, open the project's local environment settings. Use `npm ci` for worktree setup and add actions for **Start API** (`npm run dev:api`), **Start web app** (`npm run dev`), and **Verify** (`npm test && npm run build`). [Codex local environments](https://learn.chatgpt.com/docs/environments/local-environment)

## Local development

Use Node 24 and npm.

```sh
npm ci
npm run dev:api
# In another terminal:
npm run dev
# Once the API is ready:
npm run session -- 'Rehearsal'
```

Development uses embedded PostgreSQL via PGlite in `.runtime/database`. Production uses PostgreSQL through `DATABASE_URL`. The session command prints the public join code and saves private host/stage links to an ignored `.runtime/session-<code>.json` file. Sessions begin in the lobby; open the first phase in the host view.

```sh
npm test
npm run build
npm run load
# Use camera-sized images for the venue-sized upload bursts:
USERS=200 PHOTOS=200 npm run load
```

The load test creates a separate, clearly named session and exercises 400 simultaneous identities by default. Each participant submits three images, answers both ratings and the closing vote, and finishes. The test checks staff counts, both reveals, and projection consent before closing its room. Set `PHOTOS` to the number of participants who should send larger images. Use an off-peak window for load tests on Hugin.

## Hugin deployment

Connect using `ssh hugin`. The Lab lives in `~/experiments/the-lab`. Keep the existing `COMPOSE_PROJECT_NAME` and `PHOTO_DIRECTORY` in the live `.env` so deployments continue to use the same PostgreSQL volume and photo storage. The mounted directory contains a `photos` subdirectory.

1. Copy `.env.example` to `.env`. Generate separate random `DB_PASSWORD` and `ADMIN_TOKEN` values; keep this file mode 600. Use URL-safe characters in the database password. Never commit it.
2. Create `PHOTO_DIRECTORY` and give UID 1000 access to it.
3. Run `docker compose up -d --build` and check `curl -fsS http://127.0.0.1:4181/health`.
4. Add `build-api.btrbot.com → http://127.0.0.1:4181` to the existing named Cloudflare Tunnel, preserving all other routes. Validate the configuration, create the DNS route, and restart the tunnel service only when ready. No database port is exposed.
5. Confirm the public `/health` endpoint, CORS from `https://brick.btrbot.com` and `https://mctar.github.io`, and SSE through the real tunnel. Allow SSE streaming and disable caching for API responses. Do not put an interactive login/challenge in front of the participant API.

The API container is limited to two CPU cores and 1 GB memory. Image work is bounded; a busy upload gets a retryable 503 while text responses remain available. Both containers restart automatically, and images survive container replacement. Tokens are hashed, session-scoped, and role-limited. Participant access expires after two days, and standard room staff access after 30 days. In a reusable room, facilitator access lasts a year and the private projector link stays valid until revoked. The admission code only grants participant access.

To create a session on Hugin without printing administrator credentials, use the trusted host's environment or call the provisioning endpoint from inside the API container. `scripts/session.ts` is a convenience for a checkout with development dependencies. Set `API_URL`, `ADMIN_TOKEN`, and `FRONTEND_URL` to the deployed values. To provision a reusable room, add `--reusable` to the session command or pass `reusable: true` to the admin endpoint. Store the resulting private links outside Git. QR codes contain only the public participant join link.

## GitHub Pages

The app lives at `https://brick.btrbot.com/`. The repository's `main` branch deploys through `.github/workflows/pages.yml` after tests and the production build pass. Pages uses GitHub Actions with `brick.btrbot.com` configured as its custom domain and HTTPS enforced. DNS is a DNS-only CNAME from `brick.btrbot.com` to `mctar.github.io`. Actions-based Pages deployments do not require a CNAME file.

`BASE_PATH` is `./` so assets work at both the project path and domain root. `VITE_API_URL` is `https://build-api.btrbot.com`; `VITE_PUBLIC_URL` is `https://brick.btrbot.com/` for canonical join links and QR codes. Hash routing supports direct links and refreshes. Set `FRONTEND_URL=https://brick.btrbot.com/` when provisioning sessions with `scripts/session.ts`.

Keep existing phone tabs open during a domain change: drafts, photos, and anonymous access are stored per browser origin. New participants use the custom domain; switching an existing phone to a different origin starts separate local storage. Both origins remain allowed by the API.

Backend releases are controlled separately. Copy reviewed source to Hugin, set a distinct `APP_VERSION`, build the image, and recreate only this Compose app. Schema initialization is additive and version 1; future non-additive schema changes require an explicit migration and backup first. Keep the prior image available for rollback. The runtime database account owns this app's schema and is isolated from other databases; production migrations should be split into a separate role when the schema evolves.

## Recovery and event readiness

- Phones persist private drafts and a serialized submission outbox in IndexedDB. A success message requires a server acknowledgement. Transient failures retry; validation/conflict errors require a visible reconnect/review action. Clearing browser storage or changing devices loses anonymous access and local-only drafts.
- The projection screen reads durable snapshots, receives SSE invalidations, polls every 15 seconds, and retains its last snapshot when offline. Notifications are an optimization, not the stored result. One API process owns the live connections; adding replicas requires shared notification delivery.
- The current release does not promise a fully offline page reload. Keep the app open during a network interruption. Server submission and external AI still need a network.
- `docker compose restart api` recovers the app; `sudo systemctl restart cloudflared` recovers the tunnel. Neither should remove data. Never use `docker compose down -v` on a workshop deployment.
- `bash deploy/backup.sh` takes a consistent database/photo backup with a brief API pause. Copy the backup to a second device and verify restore into a separate Compose project before an important event. To restore, start an empty test database, run `pg_restore -U builders -d builders` against `database.dump`, and extract `photos.tar.gz` into the test API data volume while that API is stopped. Keep matching pairs.
- New joins receive a 90-day retention deadline. The API clears expired participant records, submissions, permissions and operation results, then deletes their photo files. Assign a facilitator to remove any raw exports, downloaded originals, and copies in backups on the same schedule. Legacy data collected before this release follows the retention decision made for that session. Exported JSON is untrusted participant content and must be escaped if imported into another UI.
- The facilitator’s **Images approved for gervilabs.com** list is the source for write-up photos. Check the list again at publication and keep the image reference with each published photo so you can act on later requests. Handle withdrawal requests sent to [Gervi Labs](https://gervilabs.com/contact/) and remove affected images from the write-up.
- Hugin and its network are single points of failure. Rehearse on the actual venue Wi-Fi with the projection computer. A 400-client burst test verifies the tested API path, not the venue's wireless capacity or a complete event-duration soak.

## Big-screen scenes

The **Instructions** view shows the current audience cue in large type. The lobby shows the QR and live join count. In new runs, the AI handoff and concept development are six minutes each, build is five minutes, reflection and neighbour exchange are two minutes each, and the final-card slot is four minutes. The build-photo cue opens before the reflection timer. Phones and the projector read the same server deadline. The facilitator can pause, resume, extend, and advance the room.

The photo wall follows the workshop phases. Build photos and concept cards appear in groups, with recent submissions alongside. The reflection and final comparison show up to eight pairs at once, and closing vote totals appear alongside the final wall. The projector prepares the next group of thumbnails. Use the **Big screen** controls below the facilitator’s stage strip to choose a manual view or pause photos. Press **J** to enlarge the QR, **Escape** to dismiss it, or **M** to toggle decorative motion. Rehearsals are marked **DRY RUN**.

Countdown music is served to authorized projector browsers from `soundtracks/` in the API’s persistent data directory (`/data/soundtracks` on Hugin). Add loop-ready PCM WAV files with unique lowercase, hyphen-separated names such as `build-loop.wav`. Put the file in place only after the transfer finishes. The server picks it up on the next timed activity. Keep the source audio or a copy of the soundtrack directory with release assets. Database and photo backups cover participant data.

## Running a rehearsal

Use the [facilitator guide](FACILITATOR-GUIDE.md) for the room sequence. On the workshop Mac, the deployed rehearsal links are in `.runtime/dry-run-access.json` and the original event links are in `.runtime/session-access.json`. Locally provisioned rooms use `.runtime/session-<code>.json`. Use the full staff links in a fresh browser. Display only the participant QR or join link to the audience.

Open the reusable room's private facilitator link once, then bookmark [Facilitator](https://brick.btrbot.com/facilitator/). Select **Connect a Mac** on the dashboard and create a one-time code for either role. Enter it at [Pair big screen](https://brick.btrbot.com/bigscreen/#/pair) or [Pair facilitator](https://brick.btrbot.com/facilitator/#/pair). Hugin issues separate room-scoped credentials. Pairing codes expire in ten minutes. A paired browser can reopen its room from the regular bookmark, and paired access lasts one year for a reusable room or 30 days for a standard room. The dashboard counts live projector tabs. Existing private staff links continue to work for recovery.

Check all three views together in a disposable room. Try the phone’s camera and camera-roll options, send the photo and prompt to an AI app, and check the manual path when the share sheet drops an item. Check the countdown on both screens, capture a build before starting reflection, and verify that only opted-in work appears. Check that the stage cues are readable from the back row. Use the confirmed reset below for another clean pass.

## Resetting a rehearsal

The facilitator's **Reset all…** control opens an **Are you sure?** dialog. Cancel has the initial focus; the final button stays disabled until the facilitator types the room code. The server also checks that code, host permission, and the session revision. A retry of the same reset request cannot reset the room twice.

Reset starts an empty run in the welcome lobby: zero registrations, answers, AI choices, gallery items, and telemetry, with no running/paused timer. The room code and host/stage links stay valid. Updated phones return to Join, discard the previous draft and upload queue, and obtain a fresh identity when they rejoin. Reload older open clients before the next test to load this behavior; their old credentials are rejected after reset. Offline phones clear their previous draft when they reconnect.

Previous server runs remain private on Hugin for recovery and retain their original retention deadlines. They are excluded from current snapshots, exports, image access, and participant writes. Reset acknowledgements in the operations table retain the previous session settings. Private notes/photos that never left a phone cannot be recovered after its draft is cleared. New rooms and confirmed resets use the required flow with join-only consent. Existing runs retain the flow they started with. Take a matching database and photo backup before changing the backend and keep a release that preserves run isolation.

## Checks

`npm test` covers phase gating, session ownership, participant/stage permissions, idempotent joins/writes, stale revisions, actual image upload/access, publication/hiding, consent revocation and stale replay, paired aggregates, pause/resume timers, CORS, and withdrawal after session closure. Reset checks cover confirmation, permissions, zeroed results, recovery isolation, unchanged staff links, idempotent retries, fresh joins, concurrent old writes, offline outbox cleanup, and late responses. The load test is separate so normal CI does not generate 400 sessions or contact production.
