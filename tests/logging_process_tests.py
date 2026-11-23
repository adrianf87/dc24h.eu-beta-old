"""Real network/logging integration without disclosing client ADC contents."""
import re
import signal
import socket
import ssl
import subprocess
import sys
import tempfile
import pathlib
import time
import unittest

from network_process_tests import BINARY, Hub, drain_until_eof
from adc_process_tests import counters
from tls_support import credentials, connect_tls, finish_tls, tls_endpoint, assert_fatal_tls_alert_or_eof


class LoggingProcessTests(unittest.TestCase):
    def test_accept_close_warnings_and_no_payload(self):
        hub = Hub(self, "--listen", "127.0.0.1:0", "--log-connections", "on")
        peer = hub.connect()
        peer.sendall(b"HPAS PRIVATE_HASH_DO_NOT_LOG\nHMSG INVALID\\q\nHSUP ADBASE\n")
        drain_until_eof(peer)
        hub.stop(signal.SIGINT)
        self.assertEqual(counters(self, hub), (2, 0, 1, 0))
        log = bytes(hub.log)
        self.assertRegex(log, rb"\[INFO\] Starting dc24h.eu beta-0.4.6")
        self.assertIn(b"Startup settings: adc_listeners=", log)
        self.assertRegex(log, rb"Connection id=\d+ transport=ADC event=accepted")
        self.assertRegex(log, rb"Connection id=\d+ transport=ADC event=login_rejected")
        self.assertIn(b"[WARN] ADC invalid frame rejected; payload omitted", log)
        self.assertNotIn(b"PRIVATE_HASH_DO_NOT_LOG", log)
        self.assertNotIn(b"INVALID", log)

    def test_warning_level_using_direct_process(self):
        with tempfile.TemporaryDirectory(prefix="dc24h-logging-") as directory:
            logfile = pathlib.Path(directory) / "hub.log"
            with socket.socket() as available:
                available.bind(('127.0.0.1', 0))
                port = available.getsockname()[1]
            process = subprocess.Popen([BINARY, "--listen", f"127.0.0.1:{port}",
                                         "--log-level", "warning", "--log-connections", "on",
                                         "--log-file", str(logfile)],
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.addCleanup(self.cleanup, process)
            deadline = time.monotonic() + 3
            while True:
                self.assertIsNone(process.poll(), 'Server exited before listening')
                try:
                    peer = socket.create_connection(('127.0.0.1', port), timeout=0.1)
                    break
                except OSError:
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.01)
            with peer:
                peer.settimeout(3)
                peer.sendall(b'HMSG BAD\\q\n')
                peer.shutdown(socket.SHUT_WR)
                drain_until_eof(peer)
            process.terminate()
            stdout, stderr = process.communicate(timeout=3)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertEqual((stdout, stderr), (b'', b''))
            data = logfile.read_bytes()
            self.assertIn(b'[WARN] ADC invalid frame rejected', data)
            self.assertNotIn(b'[INFO]', data)
            self.assertNotIn(b'Connection id=', data)

    def test_rate_limited_warning_categories_are_independent(self):
        hub = Hub(self, '--listen', '127.0.0.1:0', '--max-connections', '1', '--idle-timeout', '1')
        peer = hub.connect()
        peer.settimeout(0.1)
        with self.assertRaises(socket.timeout):
            peer.recv(1)
        for _ in range(5):
            excess = hub.connect()
            self.assertEqual(excess.recv(1), b'')
        peer.sendall(b'HMSG BAD\\q\n' * 32)
        peer.settimeout(3)
        drain_until_eof(peer)
        hub.stop()
        self.assertEqual(counters(self, hub), (0, 0, 32, 0))
        for text in (b'ADC invalid frame rejected', b'Network connection limit reached',
                     b'Network idle connection closed'):
            self.assertEqual(hub.log.count(text), 1, hub.log)
        self.assertNotIn(b'Connection id=', hub.log, 'Per-peer logging must default to off')

    def test_tls_events_bad_handshake_and_timeout(self):
        with tempfile.TemporaryDirectory(prefix='dc24h-log-tls-') as directory:
            cert, key = credentials(directory)
            hub = Hub(self, '--listen', '127.0.0.1:0', '--adcs-listen', '127.0.0.1:0',
                      '--tls-cert', cert, '--tls-key', key, '--idle-timeout', '1',
                      '--log-connections', 'on')
            with socket.create_connection(tls_endpoint(hub), timeout=3) as bad:
                bad.sendall(b'NOT_TLS_SECRET_MARKER\n')
                assert_fatal_tls_alert_or_eof(self, drain_until_eof(bad))
            with socket.create_connection(tls_endpoint(hub), timeout=3) as stalled:
                self.assertEqual(stalled.recv(1), b'')
            peer = connect_tls(self, hub, cert)
            peer.sendall(b'HPAS PRIVATE_HASH_DO_NOT_LOG\n')
            finish_tls(self, peer)
            healthy = connect_tls(self, hub, cert)
            healthy.sendall(b'\n')
            finish_tls(self, healthy)
            hub.stop()
            for event in (b'tls_handshake_failed', b'handshake_timeout', b'tls_ready', b'login_rejected', b'tls_closed'):
                self.assertIn(b'event=' + event, hub.log)
            self.assertIn(b'[WARN] ADCS handshake timed out', hub.log)
            self.assertIn(b'[WARN] ADCS handshake failed', hub.log)
            self.assertNotIn(b'NOT_TLS_SECRET_MARKER', hub.log)
            self.assertNotIn(b'PRIVATE_HASH_DO_NOT_LOG', hub.log)
            peer_records = [line for line in hub.log.splitlines() if b'Connection id=' in line]
            for line in peer_records:
                self.assertRegex(line, rb'Connection id=\d+ transport=(ADC|ADCS) event=[a-z_]+$')
                self.assertNotIn(b'127.0.0.1', line)

    def test_error_level_reports_startup_failure(self):
        with tempfile.TemporaryDirectory(prefix='dc24h-log-error-') as directory, socket.socket() as occupied:
            occupied.bind(('127.0.0.1', 0))
            occupied.listen()
            log = pathlib.Path(directory) / 'error.log'
            result = subprocess.run([BINARY, '--listen', f'127.0.0.1:{occupied.getsockname()[1]}',
                                     '--log-level', 'error', '--log-file', str(log)],
                                    capture_output=True, timeout=3)
            self.assertEqual(result.returncode, 1)
            self.assertEqual((result.stdout, result.stderr), (b'', b''))
            data = log.read_bytes()
            self.assertIn(b'[ERROR]', data)
            self.assertIn(b'bind TCP listener', data)
            self.assertNotIn(b'[INFO]', data)
            self.assertNotIn(b'[WARN]', data)

    def test_ini_logging_options_and_cli_precedence(self):
        with tempfile.TemporaryDirectory(prefix='dc24h-log-config-') as directory:
            ini = pathlib.Path(directory) / 'hub.ini'
            ini.write_text('[network]\nlisten=127.0.0.1:0\n'
                           '[logging]\nlevel=warning\nconnections=off\n', encoding='utf-8')
            hub = Hub(self, '--config', str(ini), '--log-level', 'info', '--log-connections', 'on')
            peer = hub.connect()
            peer.shutdown(socket.SHUT_WR)
            drain_until_eof(peer)
            hub.stop()
            self.assertIn(b'event=accepted', hub.log)
            self.assertIn(b'event=peer_closed', hub.log)
            self.assertIn(b'Startup settings: adc_listeners=1 adcs_listeners=0', hub.log)
            self.assertIn(b'connection_logging=on', hub.log)
            ini.write_text('[logging]\nconnections=SECRET_VALUE\n', encoding='utf-8')
            result = subprocess.run([BINARY, '--config', str(ini), '--check-config'],
                                    capture_output=True, timeout=3)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn(b'SECRET_VALUE', result.stderr)

    def test_private_log_and_security_record(self):
        with tempfile.TemporaryDirectory(prefix='dc24h-log-private-') as directory:
            blocked = pathlib.Path(directory) / 'open.log'
            blocked.write_bytes(b'earlier\n')
            blocked.chmod(0o644)
            refused = subprocess.run([BINARY, '--listen', '127.0.0.1:0', '--log-file', str(blocked)],
                                     capture_output=True, timeout=3)
            self.assertEqual(refused.returncode, 1, refused.stderr)
            self.assertIn(b'Configured log file must be private', refused.stderr)
            self.assertNotIn(b'earlier', refused.stderr)
            self.assertEqual(blocked.read_bytes(), b'earlier\n')
            self.assertEqual(blocked.stat().st_mode & 0o777, 0o644)

            logfile = pathlib.Path(directory) / 'hub.log'
            logfile.write_bytes(b'kept\n')
            logfile.chmod(0o600)
            with socket.socket() as available:
                available.bind(('127.0.0.1', 0))
                port = available.getsockname()[1]
            process = subprocess.Popen(
                [BINARY, '--listen', f'127.0.0.1:{port}', '--partial-frame-timeout', '1',
                 '--log-file', str(logfile)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.addCleanup(self.cleanup, process)
            deadline = time.monotonic() + 3
            while True:
                self.assertIsNone(process.poll(), logfile.read_bytes())
                try:
                    peer = socket.create_connection(('127.0.0.1', port), timeout=0.1)
                    break
                except OSError:
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.01)
            with peer:
                peer.settimeout(3)
                peer.sendall(b'HMSG PRIVATE_PARTIAL_DO_NOT_LOG')
                drain_until_eof(peer)
            process.terminate()
            stdout, stderr = process.communicate(timeout=3)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertEqual((stdout, stderr), (b'', b''))
            data = logfile.read_bytes()
            self.assertTrue(data.startswith(b'kept\n'), data)
            self.assertIn(b'[INFO] Starting dc24h.eu beta-0.4.6', data)
            self.assertIn(b'[WARN] Security record=partial_frame_timeout', data)
            self.assertNotIn(b'Connection id=', data)
            self.assertNotIn(b'PRIVATE_PARTIAL_DO_NOT_LOG', data)
            self.assertEqual(logfile.stat().st_mode & 0o777, 0o600)

    def test_invalid_log_configuration_values(self):
        for value in ("TRACE", "debug", "", "INVALID"):
            with self.subTest(value=value):
                result = subprocess.run([BINARY, "--log-level", value], capture_output=True, timeout=3)
                self.assertEqual(result.returncode, 2, result.stderr)
        for value in ("yes", "true", "1", ""):
            with self.subTest(value=value):
                result = subprocess.run([BINARY, "--log-connections", value],
                                        capture_output=True, timeout=3)
                self.assertEqual(result.returncode, 2, result.stderr)

    @staticmethod
    def cleanup(process):
        if process.poll() is None:
            process.kill()
        process.communicate()

if __name__ == "__main__":
    unittest.main()
