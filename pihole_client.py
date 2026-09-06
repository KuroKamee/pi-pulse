"""Local Pi-hole v6 summary client. Credentials never enter browser responses."""
import json
import math
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

PASSWORD_FILE = Path(__file__).resolve().parent / '.pihole-password'


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class PiHole:
    def __init__(self, password_reader=None):
        self.password_reader = password_reader or PASSWORD_FILE.read_text
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self.sid = None
        self.lock = threading.Lock()
        self.cached = None
        self.next_poll = 0

    def request(self, path, method='GET', payload=None):
        headers = {'Accept': 'application/json'}
        if self.sid:
            headers['X-FTL-SID'] = self.sid
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers['Content-Type'] = 'application/json'
        req = Request('http://127.0.0.1/api/' + path, data=data,
                      headers=headers, method=method)
        with self.opener.open(req, timeout=2) as response:
            raw = response.read(2_000_001)
        if len(raw) > 2_000_000:
            raise ValueError('Oversized response')
        result = json.loads(raw) if raw else {}
        if not isinstance(result, dict):
            raise ValueError('Invalid response')
        return result

    def login(self):
        self.sid = None
        password = self.password_reader()
        if not password:
            raise ValueError('Empty password')
        session = self.request('auth', 'POST', {'password': password}).get('session', {})
        if not session.get('valid') or not isinstance(session.get('sid'), str):
            raise PermissionError('Login rejected')
        self.sid = session['sid']

    def get(self, path):
        if not self.sid:
            self.login()
        try:
            return self.request(path)
        except HTTPError as error:
            if error.code != 401:
                raise
            self.login()
            return self.request(path)

    def close(self):
        if self.sid:
            try:
                self.request('auth', 'DELETE')
            except Exception:
                pass
            self.sid = None

    def summary(self):
        with self.lock:
            if time.monotonic() < self.next_poll:
                return self.cached
            retry = 10
            try:
                data = self.get('stats/summary')['queries']
                blocking = self.get('dns/blocking').get('blocking')
                if blocking is True:
                    blocking = 'enabled'
                elif blocking is False:
                    blocking = 'disabled'
                if blocking not in ('enabled', 'disabled', 'failed', 'unknown'):
                    blocking = 'unknown'
                total, blocked = data['total'], data['blocked']
                if any(type(v) is not int or v < 0 for v in (total, blocked)) or blocked > total:
                    raise ValueError('Invalid counters')
                percent = data.get('percent_blocked')
                if not isinstance(percent, (int, float)) or not math.isfinite(percent) or not 0 <= percent <= 100:
                    percent = 100 * blocked / total if total else 0.0
                result = {'state': 'connected', 'blocking': blocking,
                          'queries': total, 'blocked': blocked,
                          'percent_blocked': percent, 'sampled_at': time.time()}
            except FileNotFoundError:
                result = {'state': 'not_configured', 'message': 'Connect Pi-hole using the setup step included with this update.'}
            except (HTTPError, PermissionError) as error:
                retry = 60
                auth_error = isinstance(error, PermissionError) or error.code in (401, 403)
                result = {'state': 'unavailable', 'message': 'Pi-hole login needs attention. Run the connection setup again.' if auth_error else 'Pi-hole API unavailable. Retrying automatically.'}
            except (OSError, URLError, ValueError, KeyError, TypeError, AttributeError):
                result = {'state': 'unavailable', 'message': 'Cannot read Pi-hole statistics. Check that Pi-hole is running; retrying automatically.'}
            self.cached = result
            self.next_poll = time.monotonic() + retry
            return result
