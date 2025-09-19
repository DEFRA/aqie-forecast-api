export function parseForecastSummaryTxt(txt) {
    // Split the text into lines
    const lines = txt.split(/\r?\n/)
    const result = {}
    let currentLabel = null
    let buffer = []
  
    // Extract issue date from "Issued on ..." line
    for (const line of lines) {
      // Match lines like "Issued on Monday, 2025-09-15 at 09:00 Local time"
      const match = line.match(/^Issued on (.+) at ([0-9:]+) Local time/i)
      if (match) {
        const dateStr = match[1].replace(/^[A-Za-z]+, /, '').trim()
        const timeStr = match[2].trim()
        const dateObj = new Date(`${dateStr} ${timeStr}`)
        if (!isNaN(dateObj)) {
          // Format date as "YYYY-MM-DD HH:mm:00"
          const pad = n => n.toString().padStart(2, '0')
          result.issue_date = `${dateObj.getFullYear()}-${pad(dateObj.getMonth()+1)}-${pad(dateObj.getDate())} ${pad(dateObj.getHours())}:${pad(dateObj.getMinutes())}:00`
        }
      }
    }
  
    // Parse the sections: today, tomorrow, outlook
    for (const rawLine of lines) {
      const line = rawLine.trim()
      const lower = line.toLowerCase()
      // Detect section headers
      if (lower === 'today:' || lower === 'tomorrow:' || lower === 'outlook:') {
        // Save previous section if exists
        if (currentLabel && buffer.length) {
          result[currentLabel] = buffer.join(' ')
        }
        // Set new section label
        currentLabel = lower.replace(':', '')
        buffer = []
      } else if (currentLabel && line && !['today:', 'tomorrow:', 'outlook:'].includes(lower)) {
        // Add line to current section buffer
        buffer.push(line)
      } else if (!line && currentLabel && buffer.length) {
        // Save section when encountering a blank line
        result[currentLabel] = buffer.join(' ')
        currentLabel = null
        buffer = []
      }
    }
    // Save any remaining buffered section
    if (currentLabel && buffer.length) {
      result[currentLabel] = buffer.join(' ')
    }
    return result
  }