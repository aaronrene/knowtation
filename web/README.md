# Landing page

Single-page site for Knowtation: intent, open source, what’s included, phases, mock pricing.

## How to view in a browser

**Option 1 — Open the file directly**

- **macOS:** From the repo root run:  
  `open web/index.html`
- **Windows:** Double-click `web/index.html` or run:  
  `start web/index.html`
- Or drag `web/index.html` into your browser window.

**Option 2 — Serve with a local server (recommended if you edit links or add assets)**

From the repo root:

```bash
# Python 3
python3 -m http.server 8000 --directory web

# Or with npx (if you have Node)
npx -y serve web -p 8000
```

Then open: **http://localhost:8000**

To follow the **whitepaper** link from the landing page (`../docs/WHITEPAPER.md`), serve the **repository root** instead so `/docs/` is available, e.g. `python3 -m http.server 8000` from the repo root and open **http://localhost:8000/web/index.html**. Or open [docs/WHITEPAPER.md](../docs/WHITEPAPER.md) directly in the editor or on GitHub.

Replace `your-username` in the GitHub URLs inside `index.html` with your actual GitHub username or org before publishing.

**Hosted deploy:** One URL = **knowtation.store**. Landing at `/`, Hub at `/hub/`. "Open Knowtation Hub" points to `https://knowtation.store/hub/`. Deploy the whole `web/` folder to 4Everland and set custom domain knowtation.store. Hub UI: set `window.HUB_API_BASE_URL` to your gateway (e.g. `https://knowtation.store` if API is same origin). See [hub/gateway/README.md](../hub/gateway/README.md) and [docs/TWO-PATHS-HOSTED-AND-SELF-HOSTED.md](../docs/TWO-PATHS-HOSTED-AND-SELF-HOSTED.md).
