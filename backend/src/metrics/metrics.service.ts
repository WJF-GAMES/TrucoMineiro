import { Injectable } from '@nestjs/common';

/**
 * Métricas em memória, expostas em formato Prometheus (`GET /metrics`, protegido pelo segredo de
 * admin). Cada instância expõe as suas; o Cloud Monitoring/Prometheus agrega.
 */

const BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

interface Histogram {
  counts: number[];
  sum: number;
  count: number;
}

@Injectable()
export class MetricsService {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, () => number>();
  private readonly histograms = new Map<string, Histogram>();
  private readonly startedAt = Date.now();

  inc(name: string, labels: Record<string, string | number> = {}, by = 1) {
    const key = this.key(name, labels);
    this.counters.set(key, (this.counters.get(key) ?? 0) + by);
  }

  gauge(name: string, read: () => number) {
    this.gauges.set(name, read);
  }

  observe(name: string, valueMs: number, labels: Record<string, string | number> = {}) {
    const key = this.key(name, labels);
    let h = this.histograms.get(key);
    if (!h) {
      h = { counts: BUCKETS.map(() => 0), sum: 0, count: 0 };
      this.histograms.set(key, h);
    }
    h.sum += valueMs;
    h.count += 1;
    BUCKETS.forEach((b, i) => {
      if (valueMs <= b) h!.counts[i]! += 1;
    });
  }

  observeHttp(method: string, route: string, status: number, durationMs: number) {
    const cls = `${Math.floor(status / 100)}xx`;
    this.inc('http_requests_total', { method, route, status: cls });
    this.observe('http_request_duration_ms', durationMs, { method, route });
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.counters) out[k] = v;
    for (const [k, read] of this.gauges) out[k] = safe(read);
    return out;
  }

  render(): string {
    const lines: string[] = [];
    lines.push(`process_uptime_seconds ${Math.round((Date.now() - this.startedAt) / 1000)}`);
    const mem = process.memoryUsage();
    lines.push(`process_resident_memory_bytes ${mem.rss}`);
    lines.push(`process_heap_used_bytes ${mem.heapUsed}`);
    const cpu = process.cpuUsage();
    lines.push(`process_cpu_seconds_total ${(cpu.user + cpu.system) / 1e6}`);
    for (const [k, v] of this.counters) lines.push(`${k} ${v}`);
    for (const [k, read] of this.gauges) lines.push(`${k} ${safe(read)}`);
    for (const [k, h] of this.histograms) {
      const [name, labels] = splitKey(k);
      BUCKETS.forEach((b, i) =>
        lines.push(`${name}_bucket${joinLabels(labels, `le="${b}"`)} ${h.counts[i]}`),
      );
      lines.push(`${name}_bucket${joinLabels(labels, 'le="+Inf"')} ${h.count}`);
      lines.push(`${name}_sum${labels} ${h.sum}`);
      lines.push(`${name}_count${labels} ${h.count}`);
    }
    return lines.join('\n') + '\n';
  }

  private key(name: string, labels: Record<string, string | number>): string {
    const entries = Object.entries(labels);
    if (entries.length === 0) return name;
    const body = entries.map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`).join(',');
    return `${name}{${body}}`;
  }
}

function safe(read: () => number): number {
  try {
    const v = read();
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}

function splitKey(key: string): [string, string] {
  const i = key.indexOf('{');
  return i < 0 ? [key, ''] : [key.slice(0, i), key.slice(i)];
}

function joinLabels(labels: string, extra: string): string {
  if (!labels) return `{${extra}}`;
  return `${labels.slice(0, -1)},${extra}}`;
}
