// =============================================================================
// WHAT THIS FILE IS
//   The JavaScript entry point. It mounts <App /> into index.html's #root.
// WHY IT EXISTS
//   Vite starts here. Global CSS is imported once, here.
// =============================================================================
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { registerServiceWorker } from './lib/push'

// The service worker receives phone notifications (Web Push). It caches nothing.
void registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
