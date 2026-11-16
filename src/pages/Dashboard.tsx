import { useMemo, useState } from 'react'
import { useLive } from '../hooks/useLive'
import { supabase } from '../lib/supabase'
import { computeDashboard, fmtDays, type DashboardData } from '../lib/dashboardStats'
import { preset, type DRange } from '../lib/dateRange'
import { AreaChart, CHART, HBars, ModeSplit, PairBars, type Tone } from '../components/charts'
import { DateRangePicker } from '../components/DateRangePicker'
import { Empty, ErrorBox, Loading, Page, PageTitle, Panel, StickyHead, Tip } from '../components/ui'

const pct = (n: number | null) => (n == null ? '—' : `${n >= 99.95 || n === 0 ? Math.round(n) : n.toFixed(1)}%`)

// Each top number carries a small soft-coloured dot. Colour is a hint, never the only signal.
type Chip = 'ink' | 'blue' | 'green' | 'amber'
const DOT: Record<Chip, string> = { ink: CHART.ink, blue: CHART.blue, green: CHART.green, amber: CHART.amber }

function Kpi({ label, value, sub, chip, help }: { label: string; value: string; sub: string; chip: Chip; help: string }) {
  return (
    <Tip block label={help}>
      <div className="bg-surface shadow-card rounded-xl px-4 py-3.5 min-w-0 w-full cursor-default">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: DOT[chip] }} />
          <span className="text-[13px] text-muted leading-tight">{label}</span>
        </div>
        <div className="text-[28px] leading-tight font-semibold tracking-tight tabular-nums mt-1.5">{value}</div>
        <div className="text-[13px] text-muted mt-0.5 leading-snug">{sub}</div>
      </div>
    </Tip>
  )
}

const MODE_COLOR: Record<string, string> = { ATS: CHART.grey, 'Drop In': CHART.ink, Bluedart: '#1d4fb8', Other: CHART.mid }
const STAGE_TONE: Record<string, Tone> = {
  'Waiting for QC': 'grey',
  'QC in progress': 'blueSoft',
  'Ready to dispatch': 'blue',
  'Partially Dispatched': 'blue',
  Dispatched: 'green'
}
const AGE_TONE: Tone[] = ['grey', 'amberSoft', 'amber', 'amber']

export function Dashboard() {
  const { data, error, loading } = useLive<DashboardData>(
    async () => {
      const [s, i] = await Promise.all([
        supabase
          .from('shipments')
          .select(
            'id, fba_id, warehouse, created_at, dispatch_date, dispatch_mode, status, on_hold, shipment_lines(id, asin, product_name, unit_qty, status, received_qty, received_at), dispatches(id, dispatched_at, wm_approved_at, dispatch_lines(line_id, units))'
          )
          .order('created_at', { ascending: false })
          .limit(5000),
        supabase.from('inspections').select('id, line_id, status, inspected_qty, accepted_qty, rejected_qty, submitted_at').limit(10000)
      ])
      if (s.error) throw s.error
      if (i.error) throw i.error
      return { ships: s.data as unknown as DashboardData['ships'], insps: i.data as unknown as DashboardData['insps'] }
    },
    ['shipments', 'shipment_lines', 'dispatches', 'inspections'],
    'dashboard'
  )
  const [range, setRange] = useState<DRange>(() => preset('30'))
  const d = useMemo(() => (data ? computeDashboard(data, range) : null), [data, range])
  const rl = range.label

  return (
    <Page wide>
      <StickyHead wide>
        <PageTitle title="Dashboard" action={<DateRangePicker value={range} onChange={setRange} />} />
      </StickyHead>

      {error && <ErrorBox message={error} />}
      {loading && !data && <Loading />}
      {d?.isEmpty && <Empty>No shipments yet. Numbers appear here once shipments are created.</Empty>}

      {d && !d.isEmpty && (
        <div className="space-y-5 mt-4">
          {/* ------------------------------------------------ top numbers */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi chip="ink" help="Shipments that are not yet closed or cancelled, including any on hold." label="Open shipments" value={String(d.kpi.openShipments)} sub={d.kpi.onHold ? `${d.kpi.onHold} on hold` : 'None on hold'} />
            <Kpi chip="blue" help="Ordered units on open shipments that have not been dispatched yet." label="Units still to ship" value={d.kpi.toShip.toLocaleString()} sub="Across open shipments" />
            <Kpi chip="green" help="Units sent out in the chosen dates, counted on the day each dispatch was made." label="Units dispatched" value={d.kpi.dispatchedUnits.toLocaleString()} sub={`${d.kpi.dispatchCount} dispatch${d.kpi.dispatchCount === 1 ? '' : 'es'}, ${rl}`} />
            <Kpi
              chip="amber"
              help="Units on fully dispatched shipments that are not yet marked received at Amazon. Not affected by the date range."
              label="Waiting for Amazon"
              value={d.kpi.pendingReceive.toLocaleString()}
              sub={d.kpi.pendingReceive ? `Oldest ${fmtDays(d.kpi.oldestReceive)} ago` : 'Everything received'}
            />
            <Kpi chip="green" help="Passed units divided by checked units, for QC cases submitted in the chosen dates." label="QC pass rate" value={pct(d.kpi.passRate)} sub={d.kpi.inspected ? `${d.kpi.rejected} of ${d.kpi.inspected} units failed` : `No QC, ${rl}`} />
            <Kpi chip="blue" help="Share of dispatches made on or before the shipment's planned dispatch date." label="Dispatched on time" value={pct(d.kpi.onTimeRate)} sub={d.kpi.plannedCount ? `${d.kpi.onTimeCount} of ${d.kpi.plannedCount} by the planned date` : `No dispatches, ${rl}`} />
          </div>

          {/* ------------------------------------------------ charts */}
          <div className="grid lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2">
              <Panel fill title="Shipments per week" help="New shipments created and dispatches made, per calendar week, for the last 12 weeks.">
                <PairBars points={d.weekly} aName="Created" bName="Dispatched" />
              </Panel>
            </div>
            <Panel fill title="Where shipments are now" help="How many open shipments sit at each step right now.">
              <HBars rows={d.pipeline.map((p) => ({ label: p.label, value: p.value, tone: STAGE_TONE[p.label] ?? 'grey' }))} empty="No open shipments." />
              <p className="text-[13px] text-muted mt-4">Closed and cancelled shipments are not counted here.</p>
            </Panel>
            <div className="lg:col-span-2">
              <Panel fill title="Units dispatched per day" help="Units sent out each day in the chosen dates (up to the last 120 days).">
                <AreaChart values={d.daily.values} labels={d.daily.labels} unit="units" />
              </Panel>
            </div>
            <Panel fill title="Units dispatched by type" help="Units dispatched in the chosen dates, split by how the shipment goes out: ATS, Drop In or Bluedart.">
              <ModeSplit parts={d.modes.map((m) => ({ ...m, color: MODE_COLOR[m.label] ?? CHART.mid }))} unit={`units, ${rl}`} />
            </Panel>
          </div>

          {/* ------------------------------------------------ analytics */}
          <div className="pt-4">
            <h2 className="text-xl font-semibold tracking-tight">Shipment analytics</h2>
            <p className="text-sm text-muted mt-0.5">Figures for {rl}, unless a card says otherwise.</p>
          </div>

          <div className="grid lg:grid-cols-2 gap-5">
            <Panel fill title="How long each step takes" help="Average time between steps, for work done in the chosen dates. The median is the middle case, so a few slow ones do not skew it.">
              <ul className="divide-y divide-line -my-2">
                {d.durations.map((x) => (
                  <li key={x.label} className="py-3 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="font-medium">{x.label}</div>
                      <div className="text-[13px] text-muted">
                        {x.n ? `Median ${fmtDays(x.medianDays)} · ${x.n} ${x.n === 1 ? 'case' : 'cases'}` : 'No data in this range'}
                      </div>
                    </div>
                    <div className="text-xl font-semibold tabular-nums shrink-0">{fmtDays(x.avgDays)}</div>
                  </li>
                ))}
              </ul>
              <p className="text-[13px] text-muted mt-3">Large figure is the average. Slow steps are where shipments wait.</p>
            </Panel>

            <Panel fill title="Waiting for Amazon, by age" help="Units not yet received, grouped by days since dispatch.">
              <HBars
                rows={d.ageBuckets.map((b, i) => ({
                  label: b.label,
                  value: b.value,
                  right: `${b.value.toLocaleString()} units`,
                  note: b.shipments ? `${b.shipments} shipment${b.shipments === 1 ? '' : 's'}` : undefined,
                  tone: AGE_TONE[i]
                }))}
              />
              <p className="text-[13px] text-muted mt-4">Age is the time since dispatch, for units not yet marked received. Not affected by the date range.</p>
            </Panel>

            <Panel fill title="Products" help="Units dispatched, units still to ship, and QC pass rate per product. Scrolls when there are many." scroll flush>
              {d.products.length === 0 ? (
                <p className="p-4 text-sm text-muted">No activity in this range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[13px] text-muted">
                        <th className="font-medium px-4 py-2.5 sticky top-0 bg-surface">Product</th>
                        <th className="font-medium px-2 py-2.5 text-right sticky top-0 bg-surface">Dispatched</th>
                        <th className="font-medium px-2 py-2.5 text-right sticky top-0 bg-surface">To ship</th>
                        <th className="font-medium px-4 py-2.5 text-right sticky top-0 bg-surface">QC pass</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.products.map((p) => (
                        <tr key={p.name} className="border-t border-line">
                          <td className="px-4 py-2.5 font-medium min-w-[160px]">{p.name}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums">{p.dispatched.toLocaleString()}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums">{p.toShip.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{p.inspected ? pct((p.accepted / p.inspected) * 100) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <Panel fill title="Fulfilment centres" help="Shipments created, units dispatched and units still waiting, per fulfilment centre. Scrolls when there are many." scroll flush>
              {d.centres.length === 0 ? (
                <p className="p-4 text-sm text-muted">No activity in this range.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[13px] text-muted">
                        <th className="font-medium px-4 py-2.5 sticky top-0 bg-surface">FC</th>
                        <th className="font-medium px-2 py-2.5 text-right sticky top-0 bg-surface">Shipments</th>
                        <th className="font-medium px-2 py-2.5 text-right sticky top-0 bg-surface">Dispatched</th>
                        <th className="font-medium px-4 py-2.5 text-right sticky top-0 bg-surface">Waiting</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.centres.map((c) => (
                        <tr key={c.name} className="border-t border-line">
                          <td className="px-4 py-2.5 font-medium">{c.name}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums">{c.shipments}</td>
                          <td className="px-2 py-2.5 text-right tabular-nums">{c.dispatched.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right tabular-nums">{c.receiving.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[13px] text-muted px-4 py-3 border-t border-line">Waiting is units dispatched that Amazon has not yet received.</p>
            </Panel>
          </div>
        </div>
      )}
    </Page>
  )
}
