// Shows people's names plainly, without dots (R.K. Sharma → R K Sharma, Mohit.Kumar → Mohit Kumar).
export function personName(name: string | null | undefined): string {
  return (name ?? '').replace(/\./g, ' ').replace(/\s+/g, ' ').trim()
}
