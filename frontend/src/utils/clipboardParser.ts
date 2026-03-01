/**
 * Smart Clipboard Parser — Trade Confirmation Auto-Fill
 *
 * Handles the following input formats:
 *   1. OCC option ticker        NVDA260117P00600000
 *   2. Abbreviation style       STO 2 NVDA 600P 01/17/2026 @ 5.50
 *   3. Verb phrase style        Sell to open 2 NVDA Jan 17 2026 600 Put @ $5.50
 *   4. Sign-prefix style        -1 NVDA 600P 1/17/26 5.50
 *   5. Stock entry              Bought 100 shares NVDA @ $195.56
 *   6. IB TWS style             Sold 1 NVDA 17JAN'26 600 Put 5.50
 *
 * Returns a ParsedTrade with a 0–1 confidence score and list of matched fields.
 */

import type { TradeAction, InstrumentType, OptionType } from '@/types'

export type ParsedTrade = {
  symbol?:         string
  instrumentType?: InstrumentType
  optionType?:     OptionType
  strike?:         string       // numeric string, e.g. "600" or "600.50"
  expiry?:         string       // YYYY-MM-DD
  action?:         TradeAction
  quantity?:       string       // integer string
  price?:          string       // numeric string
  confidence:      number       // 0.0 – 1.0
  matched:         string[]     // field names successfully extracted
}

// ── Month name → zero-padded 2-digit month ────────────────────────────────────
const MONTHS: Record<string, string> = {
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
}

/** Convert various date string representations → YYYY-MM-DD, or undefined. */
function parseDate(raw: string): string | undefined {
  raw = raw.trim()

  // YYYY-MM-DD already
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  // MM/DD/YYYY or MM/DD/YY or M/D/YY
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(raw)
  if (mdy) {
    const year = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3]
    return `${year}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`
  }

  // 17JAN26 / 17JAN'26 / 17 Jan 2026  (IB TWS day-first style)
  const dmy = /^(\d{1,2})\s*([A-Za-z]{3,9})['\u2019]?(\d{2,4})$/.exec(raw)
  if (dmy) {
    const mm = MONTHS[dmy[2].toLowerCase()]
    if (!mm) return undefined
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]
    return `${year}-${mm}-${dmy[1].padStart(2, '0')}`
  }

  // Jan 17 2026 / January 17, 2026  (month-first natural language)
  const mdy2 = /^([A-Za-z]{3,9})\s+(\d{1,2})[,\s]+(\d{2,4})$/.exec(raw)
  if (mdy2) {
    const mm = MONTHS[mdy2[1].toLowerCase()]
    if (!mm) return undefined
    const year = mdy2[3].length === 2 ? `20${mdy2[3]}` : mdy2[3]
    return `${year}-${mm}-${mdy2[2].padStart(2, '0')}`
  }

  return undefined
}

/** Strike string: strip trailing ".00" for display cleanliness. */
function cleanStrike(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

// Keywords that should NOT be treated as ticker symbols
const TICKER_BLACKLIST = new Set([
  'PUT', 'CALL', 'STO', 'BTO', 'BTC', 'STC',
  'BUY', 'SELL', 'OPEN', 'CLOSE', 'QTY', 'THE',
  'AT', 'FOR', 'TO', 'AND', 'OR', 'PER', 'SHARE',
  'SHARES', 'CONTRACT', 'CONTRACTS', 'OPTION', 'STOCK',
  'LIMIT', 'MARKET', 'SHORT', 'LONG', 'SOLD', 'BOUGHT',
])

// ── Main parser ───────────────────────────────────────────────────────────────
export function parseClipboard(text: string): ParsedTrade {
  const result: ParsedTrade = { confidence: 0, matched: [] }
  if (!text.trim()) return result

  const raw = text.trim()
  const tUp  = raw.toUpperCase()

  function push(field: string) {
    if (!result.matched.includes(field)) result.matched.push(field)
  }

  // ── Step 1: OCC option ticker ────────────────────────────────────────────
  // Format: NVDA260117P00600000 (symbol + YYMMDD + C/P + 8 digit strike×1000)
  const occRx = /\b([A-Z]{1,6})(\d{2})(\d{2})(\d{2})([CP])(\d{8})\b/
  const occ   = occRx.exec(tUp)
  if (occ) {
    const [, sym, yy, mm, dd, cp, strike8] = occ
    result.symbol        = sym
    result.expiry        = `20${yy}-${mm}-${dd}`
    result.optionType    = cp === 'C' ? 'CALL' : 'PUT'
    result.strike        = cleanStrike(parseInt(strike8, 10) / 1000)
    result.instrumentType = 'OPTION'
    push('symbol'); push('expiry'); push('optionType'); push('strike'); push('instrumentType')
  }

  // ── Step 2: Instrument type (if not from OCC) ────────────────────────────
  if (!result.instrumentType) {
    if (/\bput\b|\bcall\b|\bstrike\b|\bexpir|\bpremium\b/i.test(raw) ||
        /\b\d+[CP]\b/.test(tUp)) {
      result.instrumentType = 'OPTION'
      push('instrumentType')
    } else if (/\bshares?\b|\bstock\b|\betf\b/i.test(raw)) {
      result.instrumentType = 'STOCK'
      push('instrumentType')
    }
  }

  // ── Step 3: Option type (if not from OCC) ───────────────────────────────
  if (!result.optionType) {
    if (/\bput\b/i.test(raw)) {
      result.optionType = 'PUT'; push('optionType')
    } else if (/\bcall\b/i.test(raw)) {
      result.optionType = 'CALL'; push('optionType')
    } else {
      // StrikeC / StrikeP suffix — e.g. "600P" or "600C"
      const sfx = /\b(\d+(?:\.\d+)?)\s*([CP])\b/.exec(tUp)
      if (sfx) {
        result.optionType = sfx[2] === 'C' ? 'CALL' : 'PUT'
        push('optionType')
        // Also capture strike from suffix if we don't have it yet
        if (!result.strike) {
          result.strike = sfx[1]
          push('strike')
        }
      }
    }
  }

  // ── Step 4: Action ───────────────────────────────────────────────────────
  if (!result.action) {
    if (/\bsell\s+to\s+open\b|\bsto\b/i.test(raw)) {
      result.action = 'SELL_OPEN'
    } else if (/\bbuy\s+to\s+open\b|\bbto\b/i.test(raw)) {
      result.action = 'BUY_OPEN'
    } else if (/\bbuy\s+to\s+close\b|\bbtc\b|\bcover\b/i.test(raw)) {
      result.action = 'BUY_CLOSE'
    } else if (/\bsell\s+to\s+close\b|\bstc\b/i.test(raw)) {
      result.action = 'SELL_CLOSE'
    } else if (/^[-–]\s*\d|\bsold\b|\bsell\b|\bshort\b/i.test(raw)) {
      result.action = 'SELL_OPEN'
    } else if (/^[+]\s*\d|\bbought\b|\bbuy\b|\blong\b/i.test(raw)) {
      result.action = 'BUY_OPEN'
    }
    if (result.action) push('action')
  }

  // ── Step 5: Quantity ─────────────────────────────────────────────────────
  if (!result.quantity) {
    let qty: string | undefined

    // Leading sign: "-2 NVDA" / "+3 NVDA" / "2 NVDA"
    const leadM = /^[+\-–]?\s*(\d+)\s+[A-Z]/i.exec(raw.trim())
    if (leadM) qty = leadM[1]

    // After action abbreviation: "STO 2 NVDA"
    if (!qty) {
      const abbr = /\b(?:sto|bto|btc|stc)\s+(\d+)\b/i.exec(raw)
      if (abbr) qty = abbr[1]
    }

    // After verb phrase: "Sell to open 2" / "Buy to close 3"
    if (!qty) {
      const verb = /\b(?:sell|buy)\s+to\s+(?:open|close)\s+(\d+)\b/i.exec(raw)
      if (verb) qty = verb[1]
    }

    // After sold/bought: "Sold 1 NVDA"
    if (!qty) {
      const past = /\b(?:sold|bought)\s+(\d+)\b/i.exec(raw)
      if (past) qty = past[1]
    }

    // "N shares" or "N contracts"
    if (!qty) {
      const unit = /\b(\d+)\s+(?:shares?|contracts?)\b/i.exec(raw)
      if (unit) qty = unit[1]
    }

    // "qty N" or "qty: N"
    if (!qty) {
      const kw = /\bqty\s*:?\s*(\d+)/i.exec(raw)
      if (kw) qty = kw[1]
    }

    if (qty) { result.quantity = qty; push('quantity') }
  }

  // ── Step 6: Strike (if OPTION, not yet extracted) ───────────────────────
  if (!result.strike && result.instrumentType === 'OPTION') {
    // Explicit "strike 600" / "strike: $600"
    const strikeKw = /\bstrike\s*:?\s*\$?(\d+(?:\.\d+)?)/i.exec(raw)
    if (strikeKw) { result.strike = strikeKw[1]; push('strike') }

    // Number immediately before PUT/CALL word: "600 Put" / "600 Call"
    if (!result.strike) {
      const beforeKw = /\b(\d+(?:\.\d+)?)\s+(?:put|call)\b/i.exec(raw)
      if (beforeKw) { result.strike = beforeKw[1]; push('strike') }
    }
  }

  // ── Step 7: Expiry date (if OPTION, not yet extracted) ──────────────────
  if (!result.expiry && result.instrumentType === 'OPTION') {
    const datePatterns: RegExp[] = [
      /\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/,                          // MM/DD/YYYY
      /\b(\d{4}-\d{2}-\d{2})\b/,                                    // YYYY-MM-DD
      /\b(\d{1,2}\s*[A-Za-z]{3,9}['\u2019]?\s*\d{2,4})\b/,        // 17JAN26 / 17JAN'26
      /\b([A-Za-z]{3,9}\s+\d{1,2}[,\s]+\d{2,4})\b/,               // Jan 17 2026
    ]
    for (const pat of datePatterns) {
      const m = pat.exec(raw)
      if (m) {
        const parsed = parseDate(m[1])
        if (parsed) { result.expiry = parsed; push('expiry'); break }
      }
    }
  }

  // ── Step 8: Price (after "@" / "at" / "limit") ──────────────────────────
  if (!result.price) {
    // Primary: explicit "@" or "at"
    const atM = /@\s*\$?(\d+(?:\.\d+)?)|(?:\bat\b|\blimit\b)\s+\$?(\d+(?:\.\d+)?)/i.exec(raw)
    if (atM) {
      result.price = atM[1] ?? atM[2]
      push('price')
    }

    // Fallback: last decimal number in the string (likely premium or price)
    if (!result.price) {
      const decimals = [...raw.matchAll(/\b(\d+\.\d+)\b/g)]
      if (decimals.length) {
        result.price = decimals[decimals.length - 1][1]
        // Don't push to matched — low confidence; still useful as hint
      }
    }
  }

  // ── Step 9: Symbol (if not from OCC) ────────────────────────────────────
  if (!result.symbol) {
    // Match consecutive uppercase letters (ticker candidates)
    const candidates = [...tUp.matchAll(/\b([A-Z]{1,5})\b/g)]
    for (const m of candidates) {
      if (!TICKER_BLACKLIST.has(m[1])) {
        result.symbol = m[1]
        push('symbol')
        break
      }
    }
  }

  // ── Step 10: Infer STOCK if no option markers found ──────────────────────
  if (!result.instrumentType && result.symbol && !result.optionType &&
      !result.strike && !result.expiry) {
    result.instrumentType = 'STOCK'
    push('instrumentType')
  }

  // ── Step 11: Compute confidence score ───────────────────────────────────
  // Weights: critical fields score higher
  const WEIGHTS: Record<string, number> = {
    symbol:         0.20,
    action:         0.20,
    price:          0.15,
    instrumentType: 0.10,
    quantity:       0.10,
    expiry:         0.10,
    strike:         0.10,
    optionType:     0.05,
  }
  let score = 0
  for (const field of result.matched) score += WEIGHTS[field] ?? 0
  result.confidence = Math.min(1, score)

  return result
}

/** Human-readable label for each parsed field (for the preview UI). */
export function fieldLabel(field: string, value: string): string {
  switch (field) {
    case 'action':         return value.replace('_', ' ')
    case 'symbol':         return value
    case 'instrumentType': return value
    case 'optionType':     return value
    case 'strike':         return `$${value}`
    case 'expiry':         return value
    case 'quantity':       return `${value} contract${value === '1' ? '' : 's'}`
    case 'price':          return `@ $${value}`
    default:               return value
  }
}
