import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, Box, Check, ChevronDown, ChevronRight,
  CircleHelp, Cloud, Cpu, Database, Download, Gauge, HardDrive, LayoutDashboard, ListFilter,
  Menu, MoreHorizontal, Network, Plus, RefreshCw, Search, Server, Settings, ShieldCheck, Signal,
  Terminal, X, Zap,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'

const seedServers = [
  { id: 'i-0a42f9d2c1', name: 'api-prod-01', region: 'us-east-1', type: 't3.large', status: 'online', cpu: 42, memory: 68, disk: 54, inbound: 128, outbound: 82, uptime: '24d 06h', ip: '10.0.1.24' },
  { id: 'i-0b71c8e3a4', name: 'api-prod-02', region: 'us-east-1', type: 't3.large', status: 'online', cpu: 67, memory: 74, disk: 61, inbound: 96, outbound: 112, uptime: '18d 12h', ip: '10.0.1.25' },
  { id: 'i-0c93e2f5b6', name: 'worker-queue-01', region: 'us-west-2', type: 'm5.xlarge', status: 'online', cpu: 83, memory: 81, disk: 72, inbound: 64, outbound: 38, uptime: '12d 03h', ip: '10.0.2.11' },
  { id: 'i-0d14f6a7c8', name: 'db-primary-01', region: 'us-east-1', type: 'r6g.large', status: 'online', cpu: 36, memory: 87, disk: 78, inbound: 45, outbound: 143, uptime: '46d 18h', ip: '10.0.3.8' },
  { id: 'i-0e25a8b9d0', name: 'cache-redis-01', region: 'eu-west-1', type: 't3.medium', status: 'online', cpu: 22, memory: 56, disk: 39, inbound: 38, outbound: 29, uptime: '31d 09h', ip: '10.0.4.16' },
  { id: 'i-0f36b9c0e1', name: 'staging-api-01', region: 'us-east-1', type: 't3.small', status: 'offline', cpu: 0, memory: 0, disk: 0, inbound: 0, outbound: 0, uptime: '—', ip: '10.0.5.3' },
]

const makeSeries = (n = 24, seed = 1, base = 48) => Array.from({ length: n }, (_, i) => {
  const hour = (new Date().getHours() - (n - 1 - i) + 24) % 24
  const noise = Math.sin((i + seed) * 1.7) * 9 + Math.cos((i + seed) * 0.63) * 5
  return { time: `${String(hour).padStart(2, '0')}:00`, cpu: Math.max(12, Math.round(base + noise)), memory: Math.max(32, Math.round(66 + Math.sin((i + seed) * .43) * 8)), inbound: Math.max(18, Math.round(82 + Math.sin((i + seed) * .62) * 34)), outbound: Math.max(12, Math.round(57 + Math.cos((i + seed) * .7) * 24)) }
})

const seedMetrics = {
  servers: seedServers,
  series: makeSeries(),
  source: 'demo',
  updatedAt: new Date(),
  containers: [
    { id: 'cloudpulse-nginx', name: 'cloudpulse-nginx', image: 'nginx:alpine', cpu: 2.4, memory: 34, inbound: 0.3, outbound: 0.2, status: 'running' },
    { id: 'cloudpulse-redis', name: 'cloudpulse-redis', image: 'redis:alpine', cpu: 1.2, memory: 18, inbound: 0.1, outbound: 0.1, status: 'running' },
    { id: 'cloudpulse-caddy', name: 'cloudpulse-caddy', image: 'caddy:alpine', cpu: 0.8, memory: 29, inbound: 0.2, outbound: 0.2, status: 'running' },
  ],
}

async function promQuery(base, query) {
  const url = new URL('/api/v1/query', base)
  url.searchParams.set('query', query)
  const response = await fetch(url, { signal: AbortSignal.timeout(6500) })
  if (!response.ok) throw new Error(`Prometheus returned ${response.status}`)
  const body = await response.json()
  if (body.status !== 'success') throw new Error('Prometheus query failed')
  return body.data.result
}

const asNumber = (result, fallback = null) => result?.length ? Number(result[0].value[1]) : fallback

async function loadPrometheus(base) {
  const [cpu, memory, disk, rx, tx, up] = await Promise.all([
    promQuery(base, '100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))'),
    promQuery(base, '100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))'),
    promQuery(base, '100 * (1 - (node_filesystem_avail_bytes{mountpoint="/",fstype!="rootfs"} / node_filesystem_size_bytes{mountpoint="/",fstype!="rootfs"}))'),
    promQuery(base, 'sum by (instance) (rate(node_network_receive_bytes_total{device!~"lo|docker.*|veth.*"}[5m]))'),
    promQuery(base, 'sum by (instance) (rate(node_network_transmit_bytes_total{device!~"lo|docker.*|veth.*"}[5m]))'),
    promQuery(base, 'up{job=~"node|node-exporter|cloudpulse-node-exporter"}'),
  ])
  if (![cpu, memory, disk, rx, tx, up].some((x) => x.length)) throw new Error('No Node Exporter metrics found')
  const byInstance = new Map()
  const add = (list, key, convert = Number) => list.forEach((row) => {
    const instance = row.metric.instance || row.metric.job || 'node'
    const entry = byInstance.get(instance) || { instance }
    entry[key] = convert(Number(row.value[1]))
    if (key === 'up') {
      entry.serverName = row.metric.server_name
      entry.region = row.metric.region
    }
    byInstance.set(instance, entry)
  })
  add(cpu, 'cpu'); add(memory, 'memory'); add(disk, 'disk')
  add(rx, 'inbound', (v) => v / 1024 / 1024); add(tx, 'outbound', (v) => v / 1024 / 1024)
  add(up, 'up', (v) => v === 1)
  const servers = [...byInstance.values()].map((row, i) => ({
    id: row.instance, name: row.serverName || row.instance.split(':')[0], region: row.region || 'Prometheus target', type: 'Node Exporter',
    status: row.up === false ? 'offline' : 'online', cpu: row.cpu ?? 0, memory: row.memory ?? 0,
    disk: row.disk ?? 0, inbound: row.inbound ?? 0, outbound: row.outbound ?? 0, uptime: '—', ip: row.instance,
  }))
  const points = await fetchSeries(base)
  let containers = []
  try { containers = await fetchContainers(base) } catch { /* Docker stats can be unavailable while host metrics keep working */ }
  return { servers, series: points, containers, source: 'prometheus', updatedAt: new Date() }
}

async function fetchContainers(base) {
  const [cpu, memory, rx, tx, seen, state] = await Promise.all([
    promQuery(base, '100 * sum by (id, name, image) (rate(container_cpu_usage_seconds_total{name!="",image!=""}[5m]))'),
    promQuery(base, 'sum by (id, name, image) (container_memory_working_set_bytes{name!="",image!=""})'),
    promQuery(base, 'sum by (id, name, image) (rate(container_network_receive_bytes_total{name!="",image!="",interface!="lo"}[5m]))'),
    promQuery(base, 'sum by (id, name, image) (rate(container_network_transmit_bytes_total{name!="",image!="",interface!="lo"}[5m]))'),
    promQuery(base, 'container_last_seen{name!="",image!=""}'),
    promQuery(base, 'container_state'),
  ])
  const rows = new Map()
  const add = (list, key, convert = Number) => list.forEach((item) => {
    const name = (item.metric.name || item.metric.id || 'container').replace(/^\//, '')
    const id = item.metric.id || name
    const row = rows.get(id) || { id, name, image: item.metric.image || 'Unknown image', cpu: 0, memory: 0, inbound: 0, outbound: 0, status: 'running' }
    row[key] = convert(Number(item.value[1]))
    rows.set(id, row)
  })
  add(cpu, 'cpu'); add(memory, 'memory', (value) => value / 1024 / 1024)
  add(rx, 'inbound', (value) => value / 1024 / 1024); add(tx, 'outbound', (value) => value / 1024 / 1024)
  add(seen, 'lastSeen', Number)
  state.forEach((item) => {
    const name = (item.metric.name || item.metric.id || 'container').replace(/^\//, '')
    const id = item.metric.id || name
    const row = rows.get(id) || { id, name, image: item.metric.image || 'Unknown image', cpu: 0, memory: 0, inbound: 0, outbound: 0 }
    row.status = item.metric.state || (Number(item.value[1]) === 1 ? 'running' : 'stopped')
    rows.set(id, row)
  })
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function fetchSeries(base) {
  const end = Math.floor(Date.now() / 1000)
  const start = end - 24 * 60 * 60
  const expressions = {
    cpu: '100 * (1 - avg(rate(node_cpu_seconds_total{mode="idle"}[5m])))',
    memory: '100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))',
    inbound: 'sum(rate(node_network_receive_bytes_total{device!="lo"}[5m])) / 1024 / 1024',
    outbound: 'sum(rate(node_network_transmit_bytes_total{device!="lo"}[5m])) / 1024 / 1024',
  }
  const entries = await Promise.all(Object.entries(expressions).map(async ([key, query]) => {
    const url = new URL('/api/v1/query_range', base)
    url.searchParams.set('query', query); url.searchParams.set('start', start); url.searchParams.set('end', end); url.searchParams.set('step', '1h')
    const res = await fetch(url, { signal: AbortSignal.timeout(6500) })
    if (!res.ok) throw new Error('Unable to load metric history')
    const json = await res.json()
    return [key, json.data.result?.[0]?.values || []]
  }))
  const map = new Map()
  for (const [key, values] of entries) values.forEach(([ts, value]) => {
    const time = new Date(Number(ts) * 1000).toLocaleTimeString([], { hour: '2-digit', hour12: false }) + ':00'
    const entry = map.get(time) || { time }
    entry[key] = Number(value)
    map.set(time, entry)
  })
  return [...map.values()].sort((a, b) => a.time.localeCompare(b.time))
}

const cx = (...classes) => classes.filter(Boolean).join(' ')
const pct = (value) => `${Math.round(value)}%`

function scrapeConfig(targets) {
  const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
  return `# Add this job under scrape_configs in your prometheus.yml\n- job_name: 'cloudpulse-node-exporter'\n  static_configs:\n${targets.map((item) => `    - targets: [${quote(item.target)}]\n      labels:\n        server_name: ${quote(item.name)}\n        region: ${quote(item.region)}`).join('\n')}`
}

function Meter({ value, color = 'blue', height = 5 }) {
  return <div className="meter" style={{ height }}><span className={cx('meter-fill', `fill-${color}`)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></div>
}

function Badge({ children, tone = 'neutral', dot = false }) {
  return <span className={cx('badge', `badge-${tone}`)}>{dot && <i />}{children}</span>
}

function MetricCard({ label, value, suffix, change, icon: Icon, color, note }) {
  return <article className="metric-card">
    <div className="metric-head"><span>{label}</span><span className={`icon-tile icon-${color}`}><Icon size={16} /></span></div>
    <div className="metric-value">{value}<small>{suffix}</small></div>
    <div className="metric-foot"><span className={cx('trend', change < 0 ? 'trend-down' : '')}>{change < 0 ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{Math.abs(change)}%</span><span>{note}</span></div>
    <div className={`card-glow glow-${color}`} />
  </article>
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return <div className="chart-tooltip"><strong>{label}</strong>{payload.map((item) => <div key={item.dataKey}><i style={{ background: item.color }} />{item.name}<b>{Number(item.value).toFixed(item.dataKey.includes('inbound') || item.dataKey.includes('outbound') ? 1 : 0)}{item.dataKey.includes('inbound') || item.dataKey.includes('outbound') ? ' MB/s' : '%'}</b></div>)}</div>
}

function ServerRow({ server, selected, onSelect }) {
  const loadColor = (v) => v >= 80 ? 'red' : v >= 65 ? 'amber' : 'blue'
  return <tr className={cx(selected && 'selected-row')} onClick={() => onSelect(server)}>
    <td><div className="server-name"><span className={cx('server-glyph', server.status === 'offline' && !server.pending && 'glyph-offline')}><Server size={15} /></span><div><strong>{server.name}</strong><small>{server.id}</small></div></div></td>
    <td><Badge tone={server.pending ? 'neutral' : server.status} dot>{server.pending ? 'Pending' : server.status === 'online' ? 'Online' : 'Offline'}</Badge></td>
    <td><div className="usage-cell"><span>{pct(server.cpu)}</span><Meter value={server.cpu} color={loadColor(server.cpu)} /></div></td>
    <td><div className="usage-cell"><span>{pct(server.memory)}</span><Meter value={server.memory} color={loadColor(server.memory)} /></div></td>
    <td><div className="usage-cell"><span>{pct(server.disk)}</span><Meter value={server.disk} color={loadColor(server.disk)} /></div></td>
    <td className="traffic-cell"><ArrowDownRight size={13} />{server.inbound.toFixed(0)} <small>MB/s</small></td>
    <td><button className="row-more" aria-label={`View ${server.name}`} onClick={(e) => { e.stopPropagation(); onSelect(server) }}><ChevronRight size={17} /></button></td>
  </tr>
}

function DetailPanel({ server, onClose }) {
  if (!server) return null
  return <div className="panel-scrim" onClick={onClose}><aside className="detail-panel" onClick={(e) => e.stopPropagation()}>
    <div className="panel-top"><div><Badge tone={server.status} dot>{server.status}</Badge><button className="icon-button" onClick={onClose}><X size={17} /></button></div>
      <span className="panel-server-icon"><Server size={23} /></span><h2>{server.name}</h2><p>{server.id}</p></div>
    <div className="panel-section"><h3>Resource utilization</h3>{[['CPU', server.cpu, Cpu], ['Memory', server.memory, Database], ['Disk', server.disk, HardDrive]].map(([label, value, Icon]) => <div className="detail-resource" key={label}><div><span><Icon size={14} />{label}</span><b>{pct(value)}</b></div><Meter value={value} color={value > 80 ? 'red' : value > 65 ? 'amber' : 'blue'} height={6} /></div>)}</div>
    <div className="panel-section"><h3>Instance details</h3><div className="detail-list"><span>Instance type</span><b>{server.type}</b><span>Region</span><b>{server.region}</b><span>Private IP</span><b>{server.ip}</b><span>Uptime</span><b>{server.uptime}</b><span>Inbound</span><b>{server.inbound.toFixed(1)} MB/s</b><span>Outbound</span><b>{server.outbound.toFixed(1)} MB/s</b></div></div>
    <div className="panel-note"><ShieldCheck size={16} />{server.pending ? 'Saved on this browser. Waiting for Prometheus scrape.' : 'Connected to Node Exporter metrics'}</div>
  </aside></div>
}

function AddInstanceModal({ draft, setDraft, targets, onAdd, onRemove, onDownload, onClose, error, notice }) {
  return <div className="panel-scrim" onClick={onClose}><section className="instance-modal" role="dialog" aria-modal="true" aria-labelledby="add-instance-title" onClick={(event) => event.stopPropagation()}>
    <header className="instance-modal-head"><div className="modal-icon"><Server size={19} /></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button><h2 id="add-instance-title">Add an instance</h2><p>Save it on this browser and generate a Prometheus scrape config.</p></header>
    <div className="setup-callout"><Terminal size={16} /><span><b>Before you add it</b><small>Install Node Exporter on the EC2 instance and allow the Prometheus server to reach its port 9100.</small></span></div>
    <form className="instance-form" onSubmit={onAdd}>
      <label>Instance name<input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="api-prod-03" required /></label>
      <label>Node Exporter address<input value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })} placeholder="10.0.6.42:9100" required /><small>Use an address reachable from Prometheus.</small></label>
      <label>AWS region<select value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })}><option>us-east-1</option><option>us-east-2</option><option>us-west-1</option><option>us-west-2</option><option>eu-west-1</option><option>eu-central-1</option><option>ap-south-1</option><option>ap-southeast-1</option><option>Other</option></select></label>
      {error && <div className="form-error"><AlertTriangle size={14} />{error}</div>}
      <button className="add-instance-button add-submit" type="submit"><Plus size={14} />Save instance locally</button>
    </form>
    <div className="config-list-head"><div><b>Local instances</b><span>{targets.length} saved in this browser</span></div></div>
    {targets.length > 0 ? <div className="config-targets">{targets.map((item) => <div key={item.target}><span className="target-status" /><span><b>{item.name}</b><small>{item.target} · {item.region}</small></span><button onClick={() => onRemove(item.target)} aria-label={`Remove ${item.name}`}><X size={14} /></button></div>)}</div> : <div className="config-empty">No manually added instances yet.</div>}
    {targets.length > 0 && <>
      <button className="config-download" onClick={onDownload}><Download size={15} />Download Prometheus config <span>YAML</span></button>
      <div className="config-steps"><b>After downloading</b><ol><li>Merge the generated job into <code>prometheus.yml</code> under <code>scrape_configs</code>.</li><li>Validate and reload Prometheus. The instance will change from Pending when metrics arrive.</li></ol></div>
      {notice && <div className="config-notice"><Check size={14} />{notice}</div>}
    </>}
  </section></div>
}

function App() {
  const [metrics, setMetrics] = useState(seedMetrics)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [period, setPeriod] = useState('24h')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(new Date())
  const [mobileMenu, setMobileMenu] = useState(false)
  const [instanceModal, setInstanceModal] = useState(false)
  const [instanceDraft, setInstanceDraft] = useState({ name: '', target: '', region: 'us-east-1' })
  const [targets, setTargets] = useState(() => {
    try { return JSON.parse(localStorage.getItem('cloudpulse-targets') || '[]') } catch { return [] }
  })
  const [targetError, setTargetError] = useState('')
  const [targetNotice, setTargetNotice] = useState('')
  const prometheusUrl = import.meta.env.VITE_PROMETHEUS_URL

  useEffect(() => { localStorage.setItem('cloudpulse-targets', JSON.stringify(targets)) }, [targets])

  const addTarget = (event) => {
    event.preventDefault()
    const name = instanceDraft.name.trim()
    const target = instanceDraft.target.trim()
    if (!name || !target || !instanceDraft.region) { setTargetError('Complete all fields before adding this instance.'); return }
    if (!/^[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(target)) { setTargetError('Enter a host or IP address with an optional port, such as 10.0.6.42:9100.'); return }
    if (targets.some((item) => item.target.toLowerCase() === target.toLowerCase() || item.name.toLowerCase() === name.toLowerCase())) { setTargetError('That target address or instance name is already in your config list.'); return }
    setTargets((current) => [...current, { name, target, region: instanceDraft.region }])
    setInstanceDraft({ name: '', target: '', region: 'us-east-1' })
    setTargetError('')
    setTargetNotice('Instance added to your local config list. Download the config and reload Prometheus to start monitoring it.')
  }

  const downloadPrometheusConfig = () => {
    const content = scrapeConfig(targets)
    const url = URL.createObjectURL(new Blob([content], { type: 'text/yaml' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'cloudpulse-node-exporter.yml'
    anchor.click()
    URL.revokeObjectURL(url)
    setTargetNotice('Config downloaded. Add the job under scrape_configs in prometheus.yml, validate it, then reload Prometheus.')
  }

  const refresh = useCallback(async () => {
    if (!prometheusUrl) { setMetrics(seedMetrics); setMessage('Add VITE_PROMETHEUS_URL to .env to connect Prometheus. Showing demo data.'); setLastRefresh(new Date()); return }
    setLoading(true); setMessage('')
    try {
      const normalized = prometheusUrl.replace(/\/$/, '')
      const next = await loadPrometheus(normalized)
      setMetrics(next); setMessage(next.servers.length ? '' : 'Prometheus is reachable, but no Node Exporter targets were found.')
    } catch (error) {
      setMetrics({ ...seedMetrics, updatedAt: new Date() })
      setMessage(`${error.message || 'Could not connect to Prometheus'}. Showing demo data.`)
    } finally { setLoading(false); setLastRefresh(new Date()) }
  }, [prometheusUrl])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => {
    const timer = setInterval(refresh, Number(import.meta.env.VITE_METRICS_REFRESH_MS) || 15000)
    return () => clearInterval(timer)
  }, [refresh])

  const servers = useMemo(() => {
    const matched = new Set()
    const local = targets.map((item) => {
      const found = metrics.servers.find((server) => server.id === item.target || server.ip === item.target || server.id === item.target.replace(/:\d+$/, '') || server.name === item.name)
      if (found) {
        matched.add(found.id)
        return { ...found, name: item.name, region: item.region, pending: false }
      }
      return { id: item.target, name: item.name, region: item.region, type: 'Node Exporter', status: 'offline', pending: true, cpu: 0, memory: 0, disk: 0, inbound: 0, outbound: 0, uptime: 'Awaiting scrape', ip: item.target }
    })
    return [...metrics.servers.filter((server) => !matched.has(server.id)), ...local]
  }, [metrics.servers, targets])
  const containers = metrics.containers || []
  const onlineCount = servers.filter((server) => server.status === 'online').length
  const avg = (key) => servers.filter((server) => server.status === 'online').reduce((sum, server, _, arr) => sum + server[key] / (arr.length || 1), 0)
  const cpuAvg = avg('cpu')
  const filtered = useMemo(() => servers.filter((server) => (statusFilter === 'all' || (statusFilter === 'pending' ? server.pending : !server.pending && server.status === statusFilter)) && `${server.name} ${server.id} ${server.region}`.toLowerCase().includes(query.toLowerCase())), [servers, statusFilter, query])
  const alerts = servers.flatMap((server) => [
    server.cpu >= 80 && { server, label: 'CPU usage is high', value: server.cpu, kind: 'CPU' },
    server.memory >= 85 && { server, label: 'Memory usage is high', value: server.memory, kind: 'Memory' },
    server.disk >= 80 && { server, label: 'Disk usage is high', value: server.disk, kind: 'Disk' },
    !server.pending && server.status === 'offline' && { server, label: 'Instance is unreachable', value: 0, kind: 'Offline' },
  ].filter(Boolean))
  const health = Math.round((onlineCount / (servers.length || 1)) * 100)

  return <div className="app-shell">
    <aside className={cx('sidebar', mobileMenu && 'sidebar-open')}>
      <div className="brand"><div className="brand-mark"><Activity size={21} strokeWidth={2.5} /></div><span>cloud<span>pulse</span></span><button className="mobile-close" onClick={() => setMobileMenu(false)}><X size={17} /></button></div>
      <div className="workspace-select"><div className="workspace-avatar">A</div><div><strong>Acme Cloud</strong><small>Organization</small></div><ChevronDown size={15} /></div>
      <div className="nav-label">WORKSPACE</div><nav className="side-nav">
        <a className="nav-item active"><LayoutDashboard size={17} />Overview</a>
        <a className="nav-item" href="#servers"><Server size={17} />Instances <span className="nav-count">{servers.length}</span></a>
        <a className="nav-item" href="#containers"><Box size={17} />Containers <span className="nav-count">{containers.length}</span></a>
        <a className="nav-item" href="#alerts"><Bell size={17} />Alerts {alerts.length > 0 && <span className="nav-dot" />}</a>
        <a className="nav-item" href="#metrics"><Activity size={17} />Metrics</a>
      </nav>
      <div className="nav-label nav-label-lower">MANAGE</div><nav className="side-nav">
        <a className="nav-item"><Settings size={17} />Settings</a><a className="nav-item"><CircleHelp size={17} />Help center</a>
      </nav>
      <div className="sidebar-bottom"><div className="uptime-card"><div className="uptime-head"><span className="pulse-dot" />System health<MoreHorizontal size={16} /></div><div className="uptime-number">{health}<small>%</small></div><div className="uptime-copy">{onlineCount} of {servers.length} instances operational</div><div className="uptime-track"><span style={{ width: `${health}%` }} /></div></div><div className="profile"><div className="profile-avatar">JD</div><div><strong>Jordan Davis</strong><small>Admin account</small></div><MoreHorizontal size={18} /></div></div>
    </aside>
    {mobileMenu && <div className="mobile-scrim" onClick={() => setMobileMenu(false)} />}
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu" onClick={() => setMobileMenu(true)}><Menu size={19} /></button><span>Workspace</span><ChevronRight size={14} /><strong>Overview</strong></div><div className="top-actions"><span className="live-label"><i className={onlineCount === servers.length ? '' : 'live-warning'} />{onlineCount === servers.length ? 'All systems operational' : `${servers.length - onlineCount} instance${servers.length - onlineCount === 1 ? '' : 's'} need attention`}</span><button className="top-icon" aria-label="Notifications"><Bell size={17} /><i /></button><span className="top-divider" /><button className="help-link"><CircleHelp size={15} />Help</button></div></header>
      <div className="content-wrap">
        <section className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-line" />OPERATIONS / INFRASTRUCTURE</div><h1>Infrastructure overview</h1><p>Instance health, capacity and traffic across monitored hosts.</p></div><div className="welcome-actions"><Badge tone={metrics.source === 'prometheus' ? 'live' : 'demo'} dot>{metrics.source === 'prometheus' ? 'Live data' : 'Demo mode'}</Badge><button className="refresh-button" onClick={refresh} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} />{loading ? 'Refreshing' : 'Refresh data'}</button></div></section>
        {message && <div className="notice"><AlertTriangle size={15} /><span>{message}</span><button onClick={() => setMessage('')}><X size={15} /></button></div>}
        <div className="section-title"><div><h2>Infrastructure overview</h2><p>Real-time health across all your cloud instances</p></div><span className="updated-label"><span className="pulse-dot" />Updated {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
        <section className="metric-grid">
          <MetricCard label="Total instances" value={servers.length} suffix="" change={8.2} icon={Server} color="blue" note="monitored servers" />
          <MetricCard label="Online / offline" value={onlineCount} suffix={<span className="of-total">/ {servers.length - onlineCount} offline</span>} change={2.4} icon={Signal} color="green" note={`${servers.length} total instances`} />
          <MetricCard label="Average CPU" value={Math.round(cpuAvg)} suffix="%" change={-4.8} icon={Cpu} color="violet" note="across online instances" />
          <MetricCard label="Average memory" value={Math.round(avg('memory'))} suffix="%" change={3.1} icon={Database} color="blue" note="across online instances" />
          <MetricCard label="Average disk" value={Math.round(avg('disk'))} suffix="%" change={1.2} icon={HardDrive} color="amber" note="root filesystem usage" />
          <MetricCard label="Network traffic" value={`${Math.round(servers.reduce((n, s) => n + s.inbound + s.outbound, 0))}`} suffix={<span className="of-total">MB/s</span>} change={12.6} icon={Network} color="green" note="inbound + outbound" />
        </section>
        <section className="charts-row" id="metrics">
          <article className="panel chart-panel"><div className="panel-heading"><div><h3>Performance trends</h3><p>Resource utilization over time</p></div><div className="chart-controls"><div className="chart-legend"><span><i className="legend-cpu" />CPU</span><span><i className="legend-memory" />Memory</span></div><div className="segmented">{['1h', '6h', '24h', '7d'].map((value) => <button className={period === value ? 'chosen' : ''} key={value} onClick={() => setPeriod(value)}>{value}</button>)}</div></div></div>
            <div className="chart-box"><ResponsiveContainer width="100%" height="100%"><AreaChart data={metrics.series.slice(period === '1h' ? -2 : period === '6h' ? -7 : period === '7d' ? undefined : -24)} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}><defs><linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5d8cff" stopOpacity={.2} /><stop offset="95%" stopColor="#5d8cff" stopOpacity={0} /></linearGradient><linearGradient id="memFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#b18bff" stopOpacity={.13} /><stop offset="95%" stopColor="#b18bff" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="#202b3e" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#77839a', fontSize: 10 }} tickMargin={12} minTickGap={28} /><YAxis domain={[0, 100]} axisLine={false} tickLine={false} tick={{ fill: '#77839a', fontSize: 10 }} tickFormatter={(v) => `${v}%`} ticks={[0, 25, 50, 75, 100]} /><Tooltip content={<ChartTooltip />} /><Area type="monotone" dataKey="cpu" name="CPU" stroke="#6795ff" strokeWidth={2} fill="url(#cpuFill)" activeDot={{ r: 4, fill: '#6795ff', stroke: '#111b2a', strokeWidth: 2 }} /><Area type="monotone" dataKey="memory" name="Memory" stroke="#b18bff" strokeWidth={2} fill="url(#memFill)" activeDot={{ r: 4, fill: '#b18bff', stroke: '#111b2a', strokeWidth: 2 }} /></AreaChart></ResponsiveContainer></div><div className="chart-caption"><span><span className="chart-status" />System metrics aggregated across {onlineCount} active instances</span><span>Source: {metrics.source === 'prometheus' ? 'Prometheus / Node Exporter' : 'Sample data'}</span></div>
          </article>
          <article className="panel traffic-panel"><div className="panel-heading"><div><h3>Network traffic</h3><p>Bandwidth across instances</p></div><button className="dots-button"><MoreHorizontal size={18} /></button></div><div className="traffic-total">{servers.reduce((n, s) => n + s.inbound + s.outbound, 0).toFixed(0)} <small>MB/s</small></div><div className="traffic-compare"><span className="trend"><ArrowUpRight size={13} />12.6%</span> <span>vs. previous period</span></div><div className="traffic-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={metrics.series} margin={{ top: 8, right: 0, left: -25, bottom: 0 }}><CartesianGrid stroke="#202b3e" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="time" axisLine={false} tickLine={false} tick={{ fill: '#77839a', fontSize: 9 }} minTickGap={35} /><YAxis hide /><Tooltip content={<ChartTooltip />} /><Line type="monotone" dataKey="inbound" name="Inbound" stroke="#53d6bc" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="outbound" name="Outbound" stroke="#6d92ff" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer></div><div className="traffic-legend"><span><i className="legend-in" />Inbound <b>{servers.reduce((n, s) => n + s.inbound, 0).toFixed(0)} MB/s</b></span><span><i className="legend-out" />Outbound <b>{servers.reduce((n, s) => n + s.outbound, 0).toFixed(0)} MB/s</b></span></div></article>
        </section>
        <section className="panel servers-panel" id="servers"><div className="table-heading"><div><div className="heading-with-count"><h3>Instances</h3><Badge>{servers.length}</Badge></div><p>Instances saved here and discovered by Prometheus</p></div><div className="table-actions"><label className="search-box"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search instances..." /><kbd>⌘ K</kbd></label><label className="filter-select"><ListFilter size={14} /><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}><option value="all">All status</option><option value="online">Online</option><option value="offline">Offline</option><option value="pending">Pending setup</option></select><ChevronDown size={13} /></label><button className="add-instance-button" onClick={() => { setInstanceModal(true); setTargetNotice(''); setTargetError('') }}><Plus size={14} />Add instance</button><button className="export-button" onClick={() => { const blob = new Blob([JSON.stringify(servers, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'cloudpulse-instances.json'; a.click(); URL.revokeObjectURL(a.href) }}><Download size={14} />Export</button></div></div>
          <div className="table-scroll"><table><thead><tr><th>INSTANCE <ChevronDown size={12} /></th><th>STATUS</th><th>CPU USAGE</th><th>MEMORY</th><th>DISK</th><th>INBOUND</th><th /></tr></thead><tbody>{filtered.map((server) => <ServerRow key={server.id} server={server} selected={selected?.id === server.id} onSelect={setSelected} />)}{filtered.length === 0 && <tr><td colSpan="7" className="empty-row">No instances match your search.</td></tr>}</tbody></table></div>
          <div className="table-footer"><span>Showing <b>{filtered.length}</b> of <b>{servers.length}</b> instances</span><div><button disabled>Previous</button><button className="page-current">1</button><button disabled>Next</button></div></div>
        </section>
        <section className="panel containers-panel" id="containers">
          <div className="table-heading"><div><div className="heading-with-count"><h3>Docker containers</h3><Badge>{containers.length}</Badge><Badge tone={metrics.source === 'prometheus' ? 'live' : 'demo'} dot>{metrics.source === 'prometheus' ? 'Docker API' : 'Demo'}</Badge></div><p>Per-container resource usage from Docker Engine</p></div><span className="container-refresh-note"><span className="pulse-dot" />Auto-refreshes every 15 seconds</span></div>
          <div className="container-grid">{containers.length ? containers.map((container) => <article className="container-card" key={container.id}><div className="container-card-head"><span className="container-icon"><Box size={16} /></span><div className="container-title"><strong>{container.name}</strong><small>{container.image}</small></div><Badge tone={container.status === 'running' ? 'online' : 'offline'} dot>{container.status}</Badge></div><div className="container-metrics"><div><span>CPU</span><b>{container.cpu.toFixed(1)}%</b><Meter value={container.cpu} color={container.cpu > 80 ? 'red' : container.cpu > 65 ? 'amber' : 'blue'} /></div><div><span>Memory</span><b>{container.memory.toFixed(0)} MB</b><small className="container-metric-caption">working set</small></div></div><div className="container-network"><span><ArrowDownRight size={13} />{container.inbound.toFixed(2)} MB/s in</span><span><ArrowUpRight size={13} />{container.outbound.toFixed(2)} MB/s out</span></div></article>) : <div className="container-empty"><Box size={19} /><div><strong>Container resource metrics are unavailable</strong><span>The exporter cannot read Docker’s socket with current permissions. The three demo containers are running; host metrics continue normally.</span></div></div>}</div>
        </section>
        <section className="alerts-section" id="alerts"><div className="alerts-head"><div><div className="heading-with-count"><h3>Recent alerts</h3>{alerts.length > 0 && <Badge tone="warning">{alerts.length} active</Badge>}</div><p>Thresholds and events that need your attention</p></div><button className="view-all">View alert history <ChevronRight size={14} /></button></div>
          <div className="alerts-list">{alerts.length === 0 ? <div className="all-clear"><span><Check size={16} /></span><div><strong>You're all caught up</strong><small>No active alerts. All monitored metrics are within normal ranges.</small></div></div> : alerts.slice(0, 4).map((alert, index) => <div className="alert-row" key={`${alert.server.id}-${alert.kind}`}><span className={cx('alert-icon', alert.kind === 'Offline' ? 'alert-red' : 'alert-amber')}><AlertTriangle size={15} /></span><div className="alert-main"><strong>{alert.label}</strong><small>{alert.server.name} · {alert.kind} {alert.kind !== 'Offline' ? `${alert.value}%` : ''}</small></div><span className="alert-time">{index === 0 ? 'Just now' : `${index * 4 + 2}m ago`}</span><ChevronRight size={15} className="alert-chevron" onClick={() => setSelected(alert.server)} /></div>)}</div>
        </section>
        <footer className="app-footer"><span>© 2026 CloudPulse</span><span><span className="pulse-dot" />Monitoring active</span><span>Last sync {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} <button onClick={refresh} aria-label="Sync metrics"><RefreshCw size={12} /></button></span></footer>
      </div>
    </main>
    <DetailPanel server={selected} onClose={() => setSelected(null)} />
    {instanceModal && <AddInstanceModal draft={instanceDraft} setDraft={setInstanceDraft} targets={targets} onAdd={addTarget} onRemove={(target) => setTargets((current) => current.filter((item) => item.target !== target))} onDownload={downloadPrometheusConfig} onClose={() => setInstanceModal(false)} error={targetError} notice={targetNotice} />}
  </div>
}

export default App

