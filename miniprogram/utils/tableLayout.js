const REGIONS = ["top", "right", "bottom", "left"]
const CORNERS = []
const LEGACY_CORNERS = ["topLeft", "topRight", "bottomRight", "bottomLeft"]

function emptyLayout() {
  return { top: 0, right: 0, bottom: 0, left: 0 }
}

function balancedLayout(playerCount) {
  const count = Math.max(0, Number(playerCount) || 0)
  const layout = emptyLayout()
  layout.left = Math.ceil(count / 2)
  layout.right = Math.floor(count / 2)
  return layout
}

// Kept for rooms created before the eight-region layout editor existed.
function balancedSides(playerCount) {
  const count = Math.max(0, Number(playerCount) || 0)
  return { top: Math.ceil(count / 2), bottom: Math.floor(count / 2) }
}

function assignedCount(layout) {
  return REGIONS.reduce((total, region) => total + (Number(layout && layout[region]) || 0), 0)
}

function isValidLayout(playerCount, value) {
  if (!value) return false
  const validValues = REGIONS.every(region => {
    const count = Number(value[region] || 0)
    return Number.isInteger(count) && count >= 0
  })
  return validValues && assignedCount(value) === Number(playerCount)
}

function migrateLegacyLayout(playerCount, value) {
  if (!value) return null
  const total = REGIONS.concat(LEGACY_CORNERS).reduce((sum, region) => sum + (Number(value[region]) || 0), 0)
  if (total !== Number(playerCount)) return null
  return {
    top: Number(value.top || 0) + Number(value.topLeft || 0) + Number(value.topRight || 0),
    right: Number(value.right || 0),
    bottom: Number(value.bottom || 0) + Number(value.bottomLeft || 0) + Number(value.bottomRight || 0),
    left: Number(value.left || 0)
  }
}

function normalizeLayout(playerCount, seatLayout, legacySides) {
  const count = Number(playerCount) || 0
  if (isValidLayout(count, seatLayout)) {
    const normalized = emptyLayout()
    REGIONS.forEach(region => { normalized[region] = Number(seatLayout[region] || 0) })
    return normalized
  }
  const migrated = migrateLegacyLayout(count, seatLayout)
  if (migrated) return migrated
  const old = legacySides || seatLayout
  const top = Number(old && old.top)
  const bottom = Number(old && old.bottom)
  if (Number.isInteger(top) && Number.isInteger(bottom) && top >= 0 && bottom >= 0 && top + bottom === count) {
    return { ...emptyLayout(), top, bottom }
  }
  return balancedLayout(count)
}

function normalizeSides(playerCount, tableSides) {
  const layout = normalizeLayout(playerCount, null, tableSides)
  return { top: layout.top, bottom: layout.bottom }
}

function orientationFor(layout) {
  const horizontal = Number(layout.top || 0) + Number(layout.bottom || 0)
  const vertical = Number(layout.left || 0) + Number(layout.right || 0)
  return vertical > horizontal ? "vertical" : "horizontal"
}

function tableGeometry(layout) {
  const normalized = { ...emptyLayout(), ...(layout || {}) }
  const horizontalSeats = Math.max(Number(normalized.top || 0), Number(normalized.bottom || 0))
  const verticalSeats = Math.max(Number(normalized.left || 0), Number(normalized.right || 0))
  const width = horizontalSeats ? Math.min(68, 26 + horizontalSeats * 9) : 32
  const height = verticalSeats ? Math.min(62, 24 + verticalSeats * 9) : 28
  return {
    width,
    height,
    orientation: height > width * 0.82 ? "vertical" : "horizontal"
  }
}

function linePosition(index, count, start, end, reverse) {
  if (count <= 1) return (start + end) / 2
  const value = start + (end - start) / (count - 1) * index
  return reverse ? start + end - value : value
}

function regionPosition(region, index, layout) {
  const geometry = tableGeometry(layout)
  const bounds = {
    left: 50 - geometry.width / 2,
    right: 50 + geometry.width / 2,
    top: 50 - geometry.height / 2,
    bottom: 50 + geometry.height / 2
  }
  const horizontalStart = bounds.left + 5
  const horizontalEnd = bounds.right - 5
  const verticalStart = bounds.top + 4
  const verticalEnd = bounds.bottom - 4
  if (region === "top") return { x: linePosition(index, layout.top, horizontalStart, horizontalEnd), y: Math.max(14, bounds.top - 9) }
  if (region === "right") return { x: Math.min(90, bounds.right + 8), y: linePosition(index, layout.right, verticalStart, verticalEnd) }
  if (region === "bottom") return { x: linePosition(index, layout.bottom, horizontalStart, horizontalEnd, true), y: Math.min(88, bounds.bottom + 9) }
  return { x: Math.max(10, bounds.left - 8), y: linePosition(index, layout.left, verticalStart, verticalEnd, true) }
}

function longPosition(index, playerCount, seatLayout, legacySides) {
  const layout = normalizeLayout(playerCount, seatLayout, legacySides)
  let cursor = 0
  for (let i = 0; i < REGIONS.length; i += 1) {
    const region = REGIONS[i]
    const count = layout[region]
    if (index < cursor + count) return regionPosition(region, index - cursor, layout)
    cursor += count
  }
  return { x: 50, y: 50 }
}

function roundPosition(index, playerCount) {
  const rad = (-90 + 360 / playerCount * index) * Math.PI / 180
  return { x: 50 + Math.cos(rad) * 37, y: 50 + Math.sin(rad) * 37 }
}

function seatPosition(index, playerCount, tableType, seatLayout, legacySides) {
  return tableType === "long"
    ? longPosition(index, playerCount, seatLayout, legacySides)
    : roundPosition(index, playerCount)
}

module.exports = {
  REGIONS, CORNERS, emptyLayout, balancedLayout, balancedSides, assignedCount,
  isValidLayout, normalizeLayout, normalizeSides, orientationFor, tableGeometry,
  longPosition, roundPosition, seatPosition
}
