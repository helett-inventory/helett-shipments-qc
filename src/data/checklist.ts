export interface CheckItem {
  no: number
  text: string
}

export interface CheckSection {
  id: string
  title: string
  items: CheckItem[]
}

// Mirrors the approved A4 record: sections A to C are the checks, D to H are
// quantity, scans, result and dispatch.
export const CHECK_SECTIONS: CheckSection[] = [
  {
    id: 'A',
    title: 'OUTER CARTON',
    items: [
      { no: 1, text: 'Carton clean, no dents, tears or water marks' },
      { no: 2, text: 'Carton sealed with tape, no re-taping' },
      { no: 3, text: 'Carton label legible, stuck flat, not covered' }
    ]
  },
  {
    id: 'B',
    title: 'LABELS',
    items: [
      { no: 4, text: 'FNSKU label present and scannable' },
      { no: 5, text: 'Label barcode matches product' },
      { no: 6, text: 'MRP printed' },
      { no: 7, text: 'Serial number present' },
      { no: 8, text: 'Shipping label present' }
    ]
  },
  {
    id: 'C',
    title: 'PRODUCT AND PACKING',
    items: [
      { no: 9, text: 'Product condition: no scratches, cracks, dead units' },
      { no: 10, text: 'Inner packaging in good condition' },
      { no: 11, text: 'Polybag / seal intact' },
      { no: 12, text: 'Accessories included as per BOM' }
    ]
  }
]

export const ALL_ITEMS = CHECK_SECTIONS.flatMap((s) => s.items)
