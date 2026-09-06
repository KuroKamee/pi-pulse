"""Pi Pulse: read-only metrics, served locally through an SSH tunnel."""
import argparse
import math
import json
import logging
import sqlite3
import socket
import threading
import time
from pathlib import Path
from contextlib import contextmanager
from pihole_client import PiHole

import psutil
from flask import Flask, jsonify, send_from_directory, request

BASE = Path(__file__).resolve().parent


def temperature_c():
    """Pi CPU sensor; a missing/unreadable sensor is unavailable, never zero."""
    try:
        value = float(Path('/sys/class/thermal/thermal_zone0/temp').read_text()) / 1000
        return round(value, 1) if math.isfinite(value) and -40 <= value <= 150 else None
    except (OSError, ValueError):
        return None


def collect_metrics():
    # A blocking interval gives a meaningful first CPU sample, even across threads.
    cpu = psutil.cpu_percent(interval=0.2)
    memory = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    try:
        frequency = psutil.cpu_freq()
        frequency_mhz = frequency.current if frequency else None
    except (OSError, NotImplementedError):
        frequency_mhz = None
    try:
        load = list(psutil.getloadavg())
    except (OSError, NotImplementedError):
        load = None
    swap = psutil.swap_memory()
    try:
        model = Path('/proc/device-tree/model').read_text().strip('\x00\n')
    except OSError:
        model = 'Linux device'
    interfaces = psutil.net_io_counters(pernic=True)
    # Physical Pi Ethernet/Wi-Fi interfaces only; avoid counting tunnels twice.
    interfaces = {name: {'received_bytes': item.bytes_recv, 'sent_bytes': item.bytes_sent}
                  for name, item in interfaces.items() if name.startswith(('eth', 'en', 'wl'))}
    return {
        'schema_version': 1,
        'hostname': socket.gethostname(),
        'sampled_at': time.time(),
        'temperature_c': temperature_c(),
        'cpu_percent': cpu,
        'cpu_sample_seconds': 0.2,
        'system': {'model': model, 'logical_cpus': psutil.cpu_count(),
                   'frequency_mhz': frequency_mhz, 'load_average': load,
                   'process_count': len(psutil.pids()),
                   'swap_used_bytes': swap.used, 'swap_total_bytes': swap.total},
        'network': interfaces,
        'memory': {
            'total_bytes': memory.total,
            'available_bytes': memory.available,
            'used_bytes': memory.total - memory.available,
            'percent': memory.percent,
        },
        'disk': {
            'mount': '/', 'total_bytes': disk.total, 'used_bytes': disk.used,
            'free_bytes': disk.free, 'percent': disk.percent,
        },
        'uptime_seconds': max(0, int(time.time() - psutil.boot_time())),
    }


class History:
    def __init__(self, path):
        self.path = str(path)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS samples (sampled_at REAL PRIMARY KEY, data TEXT NOT NULL)')

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        try:
            with db:
                yield db
        finally:
            db.close()

    def record(self, data):
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO samples VALUES (?, ?)',
                       (data['sampled_at'], json.dumps(data, allow_nan=False)))
            db.execute('DELETE FROM samples WHERE sampled_at < ?',
                       (data['sampled_at'] - 7 * 86400,))

    def read(self, hours):
        now = time.time()
        with self.connect() as db:
            rows = db.execute('SELECT data FROM samples WHERE sampled_at BETWEEN ? AND ? ORDER BY sampled_at',
                              (now - hours * 3600, now)).fetchall()
        return {'samples': [json.loads(row[0]) for row in rows], 'server_time': now,
                'interval_seconds': 30, 'hours': hours}


def record_loop(history, stop, reader=collect_metrics, interval=30):
    while not stop.is_set():
        started = time.monotonic()
        try:
            history.record(reader())
        except Exception:
            logging.exception('History recording failed; retrying next interval')
        stop.wait(max(0, interval - (time.monotonic() - started)))


def create_app(reader=collect_metrics, history=None, pihole=None):
    app = Flask(__name__, static_folder=str(BASE / 'static'))
    pihole = pihole if pihole is not None else PiHole()
    lock = threading.Lock()
    cache = {'data': None, 'monotonic_time': float('-inf')}

    @app.after_request
    def headers(response):
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        response.headers['Content-Security-Policy'] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "connect-src 'self'; img-src 'self'; object-src 'none'; "
            "frame-ancestors 'none'; base-uri 'none'"
        )
        return response

    @app.get('/')
    def dashboard():
        return send_from_directory(BASE / 'static', 'index.html')

    @app.get('/api/metrics')
    def metrics():
        # Limit actual sampling frequency even when several tabs are open.
        with lock:
            if time.monotonic() - cache['monotonic_time'] >= 2:
                try:
                    data = reader()
                except Exception:
                    app.logger.exception('Metrics collection failed')
                    return jsonify(error='Metrics unavailable; check collector terminal.'), 503
                cache.update(data=data, monotonic_time=time.monotonic())
            return jsonify(cache['data'])

    @app.get('/api/history')
    def saved_history():
        hours = request.args.get('hours', '1')
        if hours not in ('1', '24'):
            return jsonify(error='hours must be 1 or 24'), 400
        if history is None:
            return jsonify(error='History is not configured'), 503
        try:
            return jsonify(history.read(int(hours)))
        except Exception:
            app.logger.exception('History read failed')
            return jsonify(error='History unavailable'), 503

    @app.get('/api/pihole')
    def pihole_summary():
        return jsonify(pihole.summary())

    return app


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error('Choose a non-privileged port from 1024 through 65535.')
    from waitress import serve
    print(f'Pi Pulse listening at http://{args.host}:{args.port}', flush=True)
    print('Read-only metrics. Press Ctrl+C to stop. Default access is local/SSH only.', flush=True)
    if args.host != '127.0.0.1':
        print('WARNING: no app login or TLS. Other reachable devices can read metrics.', flush=True)
    history = History(BASE / 'history.sqlite3')
    stop = threading.Event()
    worker = threading.Thread(target=record_loop, args=(history, stop), daemon=True)
    worker.start()
    try:
        serve(create_app(history=history), host=args.host, port=args.port, threads=4,
              max_request_body_size=1024, connection_limit=32, channel_timeout=15)
    finally:
        stop.set()
        worker.join(timeout=12)
