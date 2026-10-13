# CloudPulse

CloudPulse is a responsive infrastructure dashboard with a light operations-console UI, built with React, Vite, Tailwind CSS, Recharts, and Lucide React. It reads server metrics from a Prometheus HTTP API configured in the browser. When Prometheus is not configured or is unreachable, the dashboard displays clearly labeled sample data.

## Requirements

- Node.js 20.19+ or 22.12+
- A Prometheus server scraping Node Exporter (optional; demo mode works without one)

## Run locally

```bash
npm install
copy .env.example .env
npm run dev
```

Set `VITE_PROMETHEUS_URL` in `.env` to the base URL for Prometheus, for example `http://localhost:9090`. Restart Vite after changing environment variables. `VITE_METRICS_REFRESH_MS` controls the refresh interval (defaults to 15,000 ms).

## Prometheus setup

Configure Prometheus to scrape Node Exporter on each monitored host. The dashboard runs PromQL against Node Exporter's standard metrics for CPU, memory, filesystem, network throughput, and the `up` status.

### Add an instance from CloudPulse

1. Install Node Exporter on the EC2 instance and allow inbound port `9100` from the Prometheus server only.
2. In CloudPulse, choose **Instances → Add instance**. The instance is saved in this browser's `localStorage` and immediately appears with **Pending** status.
3. Choose **Download Prometheus config**. The file contains the scrape job and all instances saved in this browser.
4. Merge that job under `scrape_configs` in your Prometheus `prometheus.yml` file. Validate with `promtool check config prometheus.yml`, then reload or restart Prometheus.
5. After Prometheus scrapes the target, refresh CloudPulse. Its metrics replace the Pending values.

There is no backend or remote registration: the localStorage list belongs to this browser, and downloading a file does not change the Prometheus server. To share instances with another browser or host, copy the list there or add the targets directly to Prometheus configuration.

Since the browser calls Prometheus directly, the Prometheus endpoint must be reachable from the browser and allow cross-origin requests from the dashboard origin. For local development, a Prometheus reverse proxy or CORS-enabled ingress can provide this. This app does not include a backend, database, or authentication layer; do not expose a sensitive Prometheus endpoint publicly.

If the URL is missing, a query fails, or no Node Exporter data is returned, CloudPulse stays usable in demo mode and displays a notice. Missing individual metrics are shown as zero rather than breaking the dashboard.

### Start the included local monitoring stack

From the `monitoring` folder, run:

```bash
docker compose up -d
docker compose ps
```

Prometheus is available at `http://localhost:9090`. Set `VITE_PROMETHEUS_URL=http://localhost:9090` in the project `.env` file and restart the Vite dev server to use it. The stack includes Node Exporter for host metrics, Docker Exporter for per-container CPU/memory/network metrics, and three sample workloads: Nginx, Redis, and Caddy. Nginx and Caddy are reachable at `http://localhost:8081` and `http://localhost:8082`.

Docker Exporter needs read access to the Docker Engine socket to collect per-container stats. Keep this local monitoring stack on a trusted development machine. It reports the Docker Desktop Linux engine's containers; Node Exporter running inside Docker Desktop reports its Linux VM/container environment, not native Windows hardware. For Windows host metrics, install `windows_exporter` and configure Prometheus to scrape it. To monitor an AWS EC2 host, install Node Exporter on that instance and add its reachable `host:9100` address through **Instances → Add instance**.

## Build

```bash
npm run build
npm run preview
```

## Project structure

```text
src/
  App.jsx       Dashboard, Prometheus client, charts, reusable UI components
  main.jsx      React entry point
  styles.css    Responsive light theme and component styles
index.html
vite.config.js
```
