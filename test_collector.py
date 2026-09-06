import unittest
from unittest.mock import patch
import collector


class CollectorTests(unittest.TestCase):
    def test_readings_have_real_capacities(self):
        d = collector.collect_metrics()
        self.assertGreater(d['memory']['total_bytes'], 0)
        self.assertGreater(d['disk']['total_bytes'], 0)
        self.assertGreaterEqual(d['uptime_seconds'], 0)
        self.assertTrue(0 <= d['cpu_percent'] <= 100)
        self.assertEqual(d['memory']['used_bytes'], d['memory']['total_bytes']-d['memory']['available_bytes'])

    def test_missing_sensor_is_null(self):
        with patch('collector.Path.read_text', side_effect=FileNotFoundError):
            self.assertIsNone(collector.temperature_c())

    def test_invalid_sensor_is_null(self):
        for text in ['bad', 'nan', '9999999']:
            with patch('collector.Path.read_text', return_value=text):
                self.assertIsNone(collector.temperature_c())

    def test_temperature_conversion(self):
        with patch('collector.Path.read_text', return_value='50500'):
            self.assertEqual(collector.temperature_c(),50.5)

    def test_cache_and_read_only_routes(self):
        calls=[]
        def reader():
            calls.append(1)
            return {'schema_version':1,'temperature_c':None}
        client=collector.create_app(reader).test_client()
        self.assertEqual(client.get('/api/metrics').status_code,200)
        response=client.get('/api/metrics')
        self.assertIsNone(response.json['temperature_c'])
        self.assertEqual(len(calls),1)
        self.assertEqual(response.headers['Cache-Control'],'no-store')
        self.assertEqual(client.post('/api/metrics').status_code,405)
        for route in ['/', '/static/app.js', '/static/style.css']:
            with client.get(route) as asset:
                self.assertEqual(asset.status_code,200)
        self.assertEqual(client.get('/static/../collector.py').status_code,404)

    def test_failure_is_503_not_fake_data(self):
        def fail():
            raise OSError('test sensor failure')
        app=collector.create_app(fail)
        app.logger.disabled=True
        response=app.test_client().get('/api/metrics')
        self.assertEqual(response.status_code,503)
        self.assertIn('error',response.json)


if __name__ == '__main__':
    unittest.main()
