# Fuzal Deployment Audit

## Checked
- All 98 files in the supplied ZIP were inventoried.
- All Python source files under `backend/` pass Python syntax compilation.
- FastAPI test suite: **12/12 passed** when executed from `backend/`.
- Puzzle images exist in both `backend/images/` and `public/images/` (5 SVG files).
- Next.js routes and game source were statically inspected for deployment-sensitive localhost references.
- Vercel deployment metadata was added.
- Python/pytest cache artifacts were removed from the deployment package.

## Important limitation
The Next.js game uses process-local in-memory lobby state and an in-process SSE connection manager. Vercel functions are not a shared persistent process, so this is suitable for a demo/test deployment but is not reliable for horizontally scaled production multiplayer.

For production multiplayer, use the included FastAPI service as the authoritative realtime backend (on a WebSocket-capable host) and move shared lobby state/fan-out to Redis or another shared service.

## Vercel target
The ZIP root is the Vercel target. `vercel.json` configures:
- Framework: Next.js
- Build: `npm run build`
- Install: `npm install`

Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS Vercel/custom domain if you want a canonical QR origin; otherwise the QR uses the current browser origin.
