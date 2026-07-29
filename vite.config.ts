import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { devApi } from './server/devMiddleware'

// In `vite dev` we serve the same /api/* routes the production serverless
// function serves, so live news works locally without a deploy.
export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
})
