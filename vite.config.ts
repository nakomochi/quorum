import tailwindcss from '@tailwindcss/vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// strictPort is the point: a silent port fallback would desync the origin from
	// BETTER_AUTH_URL and 404 every /api/auth/* route. Fail loudly instead.
	server: {
		port: 5173,
		strictPort: true
	},
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter(),

			typescript: {
				config: (config) => {
					config.include.push('../drizzle.config.ts');
					// No bun:test typings are installed; `bun run test` is what checks the tests.
					config.include = config.include.filter((path: string) => !path.startsWith('../tests/'));
				}
			}
		})
	]
});
