// Tests for finding menu dishes in recordings and keeping dish names out of venue matching.
import { describe, expect, it } from 'vitest'
import { dishEntries, findDishes, isDishWord } from './dishMatch'

const MENU = dishEntries([
  { name: 'Golden Coin', name_hi: 'गोल्डन कॉइन', section: 'Continental Snacks' },
  { name: 'Dal Makhani', name_hi: 'दाल मखनी', section: null },
  { name: 'Chutney (Tomato / Mint / Mango)', name_hi: 'चटनी (टमाटर / पुदीना / आम)', section: 'Chutney Station' },
  { name: 'Rasmalai', name_hi: 'रसमलाई', section: 'Cold Desserts' },
  { name: 'Virgin Mojito', name_hi: 'वर्जिन मोजिटो', section: 'Mocktails' },
])
const names = (t: string) => findDishes(t, MENU).dishes.map((d) => d.name)

describe('findDishes', () => {
  it('finds a dish said with a near spelling', () => {
    expect(names('Pushpanjali mein gold coin thande the')).toEqual(['Golden Coin'])
    expect(names('पुष्पांजलि में गोल्ड कॉइन ठंडे थे')).toEqual(['Golden Coin'])
  })

  it('removes the dish from the text used to find the venue', () => {
    const r = findDishes('Pushpanjali mein gold coin thande the', MENU)
    expect(r.stripped).toBe('Pushpanjali mein thande the')
    expect(isDishWord('Gold', r.words)).toBe(true)
    expect(isDishWord('Pushpanjali', r.words)).toBe(false)
  })

  it('matches the short name of a dish with options in brackets', () => {
    expect(names('chutney khatam ho gayi thi')).toEqual(['Chutney (Tomato / Mint / Mango)'])
  })

  it('finds single-word dishes only as whole words', () => {
    expect(names('rasmalai mein smell thi')).toEqual(['Rasmalai'])
    expect(names('rasmalaiyaan')).toEqual([])
  })

  it('finds drinks and several dishes together', () => {
    expect(names('dal makhani thandi thi aur virgin mojito mein barf nahi thi')).toEqual(['Dal Makhani', 'Virgin Mojito'])
  })

  it('returns the text unchanged when no dish is said', () => {
    const r = findDishes('AC kaam nahi kar raha tha', MENU)
    expect(r.dishes).toEqual([])
    expect(r.stripped).toBe('AC kaam nahi kar raha tha')
  })
})
