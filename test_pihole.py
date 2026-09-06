import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.error import HTTPError, URLError
from pihole_client import PiHole
from collector import create_app
import connect_pihole


class PiHoleTests(unittest.TestCase):
    def client(self):
        return PiHole(password_reader=lambda: 'test-private-password')

    def test_auth_summary_cache_and_secret_filtering(self):
        client = self.client()
        client.request = Mock(side_effect=[
            {'session': {'valid': True, 'sid': 'private-session'}},
            {'queries': {'total': 100, 'blocked': 30, 'percent_blocked': 30}},
            {'blocking': 'enabled'}])
        result = client.summary()
        self.assertEqual(result['blocked'], 30)
        self.assertEqual(result['blocking'], 'enabled')
        self.assertEqual(client.summary(), result)
        self.assertEqual(client.request.call_count, 3)
        self.assertNotIn('private', json.dumps(result))
        with create_app(pihole=client).test_client() as web:
            self.assertEqual(web.get('/api/pihole').json['queries'], 100)
            self.assertEqual(web.post('/api/pihole').status_code, 405)
            self.assertEqual(web.get('/.pihole-password').status_code, 404)
            self.assertEqual(web.get('/static/../.pihole-password').status_code, 404)

    def test_expired_session_reauthenticates(self):
        client = self.client()
        client.sid = 'expired'
        client.request = Mock(side_effect=[
            HTTPError('local', 401, 'Expired', {}, None),
            {'session': {'valid': True, 'sid': 'new-session'}},
            {'queries': {'total': 0, 'blocked': 0, 'percent_blocked': None}},
            {'blocking': 'disabled'}])
        result = client.summary()
        self.assertEqual(result['state'], 'connected')
        self.assertEqual(result['percent_blocked'], 0)
        self.assertEqual(result['blocking'], 'disabled')
        self.assertEqual(client.sid, 'new-session')

    def test_failures_do_not_become_zeroes(self):
        for error in (FileNotFoundError(), URLError('secret detail'),
                      HTTPError('local', 401, 'secret detail', {}, None)):
            client = self.client()
            client.request = Mock(side_effect=error)
            result = client.summary()
            self.assertNotEqual(result['state'], 'connected')
            self.assertNotIn('queries', result)
            self.assertNotIn('secret', json.dumps(result))
            calls = client.request.call_count
            client.summary()
            self.assertEqual(client.request.call_count, calls)

    def test_setup_saves_private_file_only_after_success(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.pihole-password'
            with patch.object(connect_pihole, 'PASSWORD_FILE', path), \
                 patch.object(connect_pihole.getpass, 'getpass', return_value='new-private'), \
                 patch.object(connect_pihole, 'PiHole') as factory, patch('builtins.print'):
                client = factory.return_value
                client.summary.return_value = {'state': 'connected'}
                self.assertEqual(connect_pihole.main(), 0)
                self.assertEqual(os.stat(path).st_mode & 0o777, 0o600)
                self.assertEqual(path.read_text(), 'new-private')
                client.summary.return_value = {'state': 'unavailable', 'message': 'Rejected'}
                self.assertEqual(connect_pihole.main(), 1)
                self.assertEqual(path.read_text(), 'new-private')
                self.assertEqual(client.close.call_count, 2)


if __name__ == '__main__':
    unittest.main()
