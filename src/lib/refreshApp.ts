// Reloads the app and makes sure the newest version is loaded.
export async function refreshApp(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration()
    if (reg) {
      await reg.update()
      const next = reg.installing ?? reg.waiting
      if (next) {
        await new Promise<void>((done) => {
          const timer = setTimeout(done, 4000)
          next.addEventListener('statechange', () => {
            if (next.state === 'activated' || next.state === 'redundant') { clearTimeout(timer); done() }
          })
        })
      }
    }
  } catch { }
  window.location.reload()
}
