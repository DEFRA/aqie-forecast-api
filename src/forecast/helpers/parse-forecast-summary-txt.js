function createFlushBuffer(result) {
  let currentLabel = null
  let buffer = []

  const flushBuffer = () => {
    if (currentLabel && buffer.length) {
      result[currentLabel] = buffer.join(' ')
      buffer = []
      currentLabel = null
    }
  }

  return {
    flushBuffer,
    getCurrentLabel: () => currentLabel,
    setCurrentLabel: (label) => {
      currentLabel = label
    },
    addToBuffer: (text) => buffer.push(text),
    hasBuffer: () => buffer.length > 0
  }
}

function extractIssueDate(lines, result) {
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
}

function processSectionLine(line, sectionHeaders, bufferManager) {
  const lower = line.toLowerCase()

  if (sectionHeaders.has(lower)) {
    bufferManager.flushBuffer()
    bufferManager.setCurrentLabel(lower.replace(':', ''))
  } else if (
    bufferManager.getCurrentLabel() &&
    line &&
    !sectionHeaders.has(lower)
  ) {
    bufferManager.addToBuffer(line)
  } else if (
    !line &&
    bufferManager.getCurrentLabel() &&
    bufferManager.hasBuffer()
  ) {
    bufferManager.flushBuffer()
  } else {
    // Handle all other cases - lines that don't match any condition
    // This ensures the if-else chain is complete
  }
}

export function parseForecastSummaryTxt(txt) {
  const lines = txt.split(/\r?\n/)
  const result = {}
  const bufferManager = createFlushBuffer(result)

  // Extract issue date from "Issued on ..." line
  extractIssueDate(lines, result)

  // Process section content
  const sectionHeaders = new Set(['today:', 'tomorrow:', 'outlook:'])

  for (const rawLine of lines) {
    const line = rawLine.trim()
    processSectionLine(line, sectionHeaders, bufferManager)
  }

  bufferManager.flushBuffer()
  return result
}
