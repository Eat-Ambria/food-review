// =============================================================================
// WHAT THIS FILE IS
//   Vite build configuration.
// WHY IT EXISTS
//   • React + Tailwind CSS v4 (Tailwind runs as a Vite plugin; no extra config files).
//   • `base`: the URL path the app is served from. "/" locally; for GitHub
//     Pages it must be "/<repo-name>/". Set it with VITE_BASE when building:
//       VITE_BASE=/issue-desk/ npm run build
//   • Build id + version.json: every build gets a unique id baked into the app
//     AND written to version.json. A running app checks version.json every
//     few minutes; if the id changed, it shows "New version, Reload"
//     (components/UpdateNotice.tsx).
//   • 404.html: GitHub Pages serves it for unknown paths, so a link straight
//     to /issues still opens the app (a copy of index.html).
// USED BY
//   npm run dev / npm run build
// =============================================================================
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const BUILD_ID = String(Date.now())

function releaseFiles(): Plugin {
  let outDir = 'dist'
  return {
    name: 'issue-desk-release-files',
    apply: 'build',
    configResolved(cfg) { outDir = cfg.build.outDir },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) })
    },
    closeBundle() {
      const index = resolve(outDir, 'index.html')
      if (existsSync(index)) copyFileSync(index, resolve(outDir, '404.html'))
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), releaseFiles()],
  base: process.env.VITE_BASE || '/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // Unit tests import Edge Function files, which use Deno's "jsr:" import; map it
  // to the same npm package for Node. (The app itself never imports it.)
  resolve: { alias: { 'jsr:@supabase/supabase-js@2': '@supabase/supabase-js' } },
})
