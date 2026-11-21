// Starts the app.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './lib/noZoom'
import './lib/ripple'
import App from './App'
import { registerServiceWorker } from './lib/push'

void registerServiceWorker()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
