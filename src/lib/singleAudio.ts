// Lets only one recording play at a time: starting one pauses the one that was playing.
let current: HTMLMediaElement | null = null

export function playingNow(el: HTMLMediaElement): void {
  if (current && current !== el && !current.paused) current.pause()
  current = el
}
