// Build settings for the app (Vite): plugins, base path and the version file.
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

  resolve: { alias: { 'jsr:@supabase/supabase-js@2': '@supabase/supabase-js' } },
})
