export function parseForecastSummaryTxt(txt) {
  const lines = txt.split(/\r?\n/)
  const result = {}
  let currentLabel = null
  let buffer = []

  // Helper to flush buffer to result
  const flushBuffer = () => {
    if (currentLabel && buffer.length) {
      result[currentLabel] = buffer.join(' ')
      buffer = []
      currentLabel = null
    }
  }

  // Extract issue date from "Issued on ..." line
  for (const line of lines) {
    const match = line.match(/^Issued on (.+) at ([0-9:]+) Local time/i)
    if (match) {
      const dateStr = match[1].replace(/^[A-Za-z]+, /, '').trim()
      const timeStr = match[2].trim()
      const dateObj = new Date(`${dateStr} ${timeStr}`)
      if (!isNaN(dateObj)) {
        const pad = (n) => n.toString().padStart(2, '0')
        result.issue_date = `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:00`
      }
      break // Only need the first match
    }
  }

  const sectionHeaders = ['today:', 'tomorrow:', 'outlook:']

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const lower = line.toLowerCase()

    if (sectionHeaders.includes(lower)) {
      flushBuffer()
      currentLabel = lower.replace(':', '')
    } else if (currentLabel && line && !sectionHeaders.includes(lower)) {
      buffer.push(line)
    } else if (!line && currentLabel && buffer.length) {
      flushBuffer()
    }
  }
  flushBuffer()
  return result
}
