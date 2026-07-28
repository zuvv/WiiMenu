import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://zuvv.github.io/WiiMenu/, so asset URLs need the repo
  // name in front. Code reads this back as import.meta.env.BASE_URL (see
  // NewsFeed.ts and the channel textures), so nothing hardcodes the path.
  base: '/WiiMenu/',
  plugins: [react()],
})
