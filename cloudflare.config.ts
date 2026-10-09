import { defineConfig } from 'cf/config';

// Assets-only: no entrypoint, so the Vite client build is served as static assets.
export default defineConfig({
	worker: {
		name: 'etymology-translator',
		compatibilityDate: '2026-10-08',
		assets: {
			// serves 404.html (copied over from public/404.html)
			notFoundHandling: '404-page',
		},
	},
});
