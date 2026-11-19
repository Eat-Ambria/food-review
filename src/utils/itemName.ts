// Shows dish names neatly in English letters (पनीर → Paneer, khana → Khana).
const DISH_WORDS: Record<string, string> = {
  'पनीर': 'Paneer', 'दाल': 'Dal', 'मखनी': 'Makhani', 'मक्खनी': 'Makhani', 'खाना': 'Khana', 'भोजन': 'Bhojan',
  'चावल': 'Chawal', 'रोटी': 'Roti', 'नान': 'Naan', 'पराठा': 'Paratha', 'पूरी': 'Puri', 'कुलचा': 'Kulcha',
  'सब्ज़ी': 'Sabzi', 'सब्जी': 'Sabzi', 'चिकन': 'Chicken', 'मटन': 'Mutton', 'मछली': 'Fish', 'अंडा': 'Egg',
  'बिरयानी': 'Biryani', 'पुलाव': 'Pulao', 'रायता': 'Raita', 'सलाद': 'Salad', 'सूप': 'Soup', 'चाट': 'Chaat',
  'टिक्का': 'Tikka', 'कबाब': 'Kebab', 'कोफ्ता': 'Kofta', 'छोले': 'Chole', 'भटूरे': 'Bhature', 'राजमा': 'Rajma',
  'कढ़ी': 'Kadhi', 'कढ़ाई': 'Kadai', 'मलाई': 'Malai', 'मिठाई': 'Mithai', 'गुलाब': 'Gulab', 'जामुन': 'Jamun',
  'रसगुल्ला': 'Rasgulla', 'हलवा': 'Halwa', 'खीर': 'Kheer', 'जलेबी': 'Jalebi', 'आइसक्रीम': 'Ice Cream',
  'चाय': 'Chai', 'कॉफी': 'Coffee', 'पानी': 'Water', 'जूस': 'Juice', 'लस्सी': 'Lassi', 'मॉकटेल': 'Mocktail',
  'चॉप': 'Chop', 'स्टार्टर': 'Starter', 'मेन': 'Main', 'कोर्स': 'Course', 'डेज़र्ट': 'Dessert', 'डेजर्ट': 'Dessert',
  'प्लेट': 'Plate', 'गिलास': 'Glass', 'चम्मच': 'Spoon', 'वॉशरूम': 'Washroom', 'बाथरूम': 'Bathroom', 'टॉयलेट': 'Toilet',
  'लाइट': 'Light', 'पंखा': 'Fan', 'कुर्सी': 'Chair', 'टेबल': 'Table', 'साउंड': 'Sound', 'पार्किंग': 'Parking',
}

const VOWELS: Record<string, string> = { 'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au', 'ऋ': 'ri' }
const MATRAS: Record<string, string> = { 'ा': 'aa', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ृ': 'ri', 'ॉ': 'o', 'ॅ': 'e' }
const CONS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n', 'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n', 'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'f', 'ब': 'b', 'भ': 'bh', 'म': 'm', 'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh',
  'ष': 'sh', 'स': 's', 'ह': 'h', 'ळ': 'l',
}
const DEVANAGARI = /[ऀ-ॿ]/

function translit(word: string): string {
  const chars = [...word.replace(/़/g, '')]
  let out = ''
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i], next = chars[i + 1]
    if (CONS[c]) {
      out += CONS[c]
      if (next === '्') { i++; continue }
      if (next && MATRAS[next]) { out += MATRAS[next]; i++; continue }
      out += 'a'
    } else if (VOWELS[c]) out += VOWELS[c]
    else if (c === 'ं' || c === 'ँ') out += 'n'
    else if (MATRAS[c]) out += MATRAS[c]
    else if (!DEVANAGARI.test(c)) out += c
  }
  if (/[^aeiou]a$/.test(out) && out.length > 3) out = out.slice(0, -1)
  return out
}

const titleWord = (w: string) =>
  (w.length <= 3 && w === w.toUpperCase() && /[A-Z]/.test(w)) || /[A-Z]/.test(w.slice(1))
    ? w
    : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()

export function displayItem(item: string | null | undefined): string {
  const t = (item ?? '').normalize('NFC').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  return t.split(' ').map((w) => {
    if (!DEVANAGARI.test(w)) return titleWord(w)
    return DISH_WORDS[w] ?? titleWord(translit(w))
  }).join(' ')
}
