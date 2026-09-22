const INDUSTRY_COPY = {
  sweeper: {
    passesRequired: 4,
    startLabel: 'Start Sweep',
    coverageLabel: 'swept',
    tagline: 'STREET SWEEP OPS',
  },
  trash: {
    passesRequired: 2,
    startLabel: 'Start Collection',
    coverageLabel: 'collected',
    tagline: 'COLLECTION OPS',
  },
  delivery: {
    passesRequired: 1,
    startLabel: 'Start Delivery',
    coverageLabel: 'delivered',
    tagline: 'DELIVERY OPS',
  },
  lawn: {
    passesRequired: 1,
    startLabel: 'Start Service',
    coverageLabel: 'serviced',
    tagline: 'FIELD SERVICE OPS',
  },
  tree: {
    passesRequired: 1,
    startLabel: 'Start Service',
    coverageLabel: 'serviced',
    tagline: 'FIELD SERVICE OPS',
  },
  roofing: {
    passesRequired: 1,
    startLabel: 'Start Inspection',
    coverageLabel: 'inspected',
    tagline: 'ROOFING OPS',
  },
}

const DEFAULT_COPY = {
  passesRequired: 1,
  startLabel: 'Start Route',
  coverageLabel: 'covered',
  tagline: 'FIELD SERVICE OPS',
}

/**
 * Sweepers cover each lane of a two-lane road twice (once per side of that
 * lane) — 4 passes total. Trash trucks cover the left and right side of a
 * two-lane road once each — 2 passes. Everyone else defaults to 1.
 */
export function getIndustryCopy(industry) {
  return INDUSTRY_COPY[industry] ?? DEFAULT_COPY
}
