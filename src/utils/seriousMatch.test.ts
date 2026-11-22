// Tests for serious keyword matching: whole words, Hindi script, and venue names that look like keywords.
import { describe, expect, it } from 'vitest'
import { matchKeywords, placeNames, placesContaining } from './seriousMatch'

const KEYWORDS = ['glass', 'kaanch', 'baal', 'बाल', 'aag', 'कीड़ा', 'food poisoning', 'smell']
const PLACES = placeNames([
  { venue_name: 'Glass House', sub_venues: ['Crystal Lawn', 'Glass Hall'], aliases: [{ alias: 'ग्लास हाउस' }] },
  { venue_name: 'Pushpanjali', sub_venues: [], aliases: [{ alias: 'पुष्पांजलि' }] },
])

describe('matchKeywords', () => {
  it('ignores a keyword that is only part of a venue name', () => {
    expect(matchKeywords(KEYWORDS, ['Glass House mein AC kaam nahi kar raha'], PLACES)).toEqual([])
    expect(matchKeywords(KEYWORDS, ['ग्लास हाउस में सर्विस धीमी थी'], PLACES)).toEqual([])
    expect(matchKeywords(KEYWORDS, ['Glass Hall ka stage late laga'], PLACES)).toEqual([])
  })

  it('still finds a real problem said at that venue', () => {
    expect(matchKeywords(KEYWORDS, ['Glass House mein dal mein kaanch mila'], PLACES)).toEqual(['kaanch'])
    expect(matchKeywords(KEYWORDS, ['Glass piece found in the dal at Glass House'], PLACES)).toEqual(['glass'])
  })

  it('matches whole words only', () => {
    expect(matchKeywords(KEYWORDS, ['aage se khana thanda tha'], PLACES)).toEqual([])
    expect(matchKeywords(KEYWORDS, ['kitchen mein aag lagi'], PLACES)).toEqual(['aag'])
    expect(matchKeywords(KEYWORDS, ['baalti mein paani nahi tha'], PLACES)).toEqual([])
  })

  it('matches Hindi script and phrases', () => {
    expect(matchKeywords(KEYWORDS, ['सब्जी में बाल था'], PLACES)).toEqual(['बाल'])
    expect(matchKeywords(KEYWORDS, ['सलाद में कीड़ा मिला'], PLACES)).toEqual(['कीड़ा'])
    expect(matchKeywords(KEYWORDS, ['Two guests had Food Poisoning.'], PLACES)).toEqual(['food poisoning'])
  })

  it('returns nothing when there is no text', () => {
    expect(matchKeywords(KEYWORDS, [], PLACES)).toEqual([])
    expect(matchKeywords(KEYWORDS, [null, ''], PLACES)).toEqual([])
  })
})

describe('placesContaining', () => {
  it('lists the venue names a keyword is part of', () => {
    expect(placesContaining('glass', PLACES)).toEqual(['Glass House', 'Glass Hall'])
    expect(placesContaining('kaanch', PLACES)).toEqual([])
  })
})
