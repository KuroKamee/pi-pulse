import tempfile
import threading
import time
import unittest
from pathlib import Path
from collector import History, collect_metrics, create_app, record_loop


class HistoryTests(unittest.TestCase):
    def test_retention_and_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'history.sqlite3'
            history = History(path)
            sample = collect_metrics()
            now = time.time()
            for age in (8*86400, 7200, 0):
                history.record(dict(sample, sampled_at=now-age))
            restarted = History(path)
            self.assertEqual(len(restarted.read(1)['samples']), 1)
            self.assertEqual(len(restarted.read(24)['samples']), 2)
            with restarted.connect() as db:
                self.assertEqual(db.execute('SELECT count(*) FROM samples').fetchone()[0], 2)
            with create_app(history=restarted).test_client() as client:
                self.assertEqual(len(client.get('/api/history?hours=24').json['samples']), 2)
                self.assertEqual(client.get('/api/history?hours=999').status_code, 400)

    def test_records_without_browser_and_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            history = History(Path(directory) / 'history.sqlite3')
            stop = threading.Event()
            calls = []
            sample = collect_metrics()
            def reader():
                calls.append(1)
                if len(calls) == 1:
                    raise OSError('temporary sensor error')
                stop.set()
                return sample
            with self.assertLogs(level='ERROR'):
                worker = threading.Thread(target=record_loop, args=(history, stop, reader, .01))
                worker.start()
                worker.join(timeout=3)
            self.assertFalse(worker.is_alive())
            self.assertEqual(len(history.read(1)['samples']), 1)

if __name__ == '__main__':
    unittest.main()
