"""Real private Unix HTTP API: framing, auth, limits, privacy and lifecycle."""
import json
import os
import re
from pathlib import Path
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

from network_process_tests import Hub, BINARY, drain_until_eof
from api_support import enable_api, fetch_status
from adc_login_process_tests import Peer, pair


class Fixture:
    def __init__(self, case, extra=''):
        self.case = case
        self.temp = tempfile.TemporaryDirectory(prefix='dc24h-api-')
        case.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name)
        self.ini = self.folder / 'hub.ini'
        self.ini.write_text('[network]\nlisten=127.0.0.1:0\n')
        self.endpoint, self.token = enable_api(self.ini, self.folder)
        with self.ini.open('a') as stream:
            stream.write(extra)
        self.hub = None

    def start(self, *args):
        pattern = re.compile('Sieć nasłuchuje na '.encode() + rb'(\[[^\]]+\]|[^ :]+):([0-9]+)') if 'pl' in args else None
        self.hub = Hub(self.case, '--config', str(self.ini), *args, **({'ready_pattern': pattern} if pattern else {}))
        return self.hub

    def connect(self):
        peer = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        peer.settimeout(3)
        peer.connect(str(self.endpoint))
        self.case.addCleanup(peer.close)
        return peer

    def request(self, method='GET', target='/api/v1/status', auth=True, headers='', body='', fragments=False, raw=None):
        data = raw if raw is not None else (method + ' ' + target + ' HTTP/1.1\r\nHost: local\r\n' +
            ('Authorization: Bearer ' + self.token + '\r\n' if auth else '') + headers + '\r\n' + body).encode()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as peer:
            peer.settimeout(3); peer.connect(str(self.endpoint))
            if fragments:
                for value in data:
                    peer.sendall(bytes([value]))
            else:
                peer.sendall(data)
            response = bytearray()
            while True:
                try:
                    part = peer.recv(16384)
                except ConnectionResetError:
                    break
                if not part:
                    break
                response.extend(part)
                self.case.assertLess(len(response), 8448)
        return bytes(response)

    def decode(self, raw, expected=200, head=False):
        headers, body = raw.split(b'\r\n\r\n', 1)
        status_line, *lines = headers.decode('ascii').split('\r\n')
        self.case.assertEqual(int(status_line.split()[1]), expected, raw)
        fields = dict(line.lower().split(': ', 1) for line in lines)
        self.case.assertEqual(fields['connection'], 'close')
        self.case.assertEqual(fields['cache-control'], 'no-store')
        self.case.assertEqual(fields['content-type'], 'application/json; charset=utf-8')
        self.case.assertEqual(fields['x-content-type-options'], 'nosniff')
        self.case.assertEqual(len(body), 0 if head else int(fields['content-length']))
        return fields, None if head else json.loads(body)


class ApiProcessTests(unittest.TestCase):
    def test_authentication_routes_and_real_counters(self):
        fx = Fixture(self); hub = fx.start('--log-connections', 'on')
        self.assertEqual(stat.S_IMODE(fx.endpoint.stat().st_mode), 0o600)
        fields, body = fx.decode(fx.request(auth=False), 401)
        self.assertIn('www-authenticate', fields)
        self.assertEqual(body, {'error': 'unauthorized'})
        fx.decode(fx.request(auth=False, headers='Authorization: Bearer ' + '0' * 64 + '\r\n'), 401)
        fx.decode(fx.request(method='POST', target='/private-route', auth=False), 401)
        fx.decode(fx.request(target='/private-route'), 404)
        fields, _ = fx.decode(fx.request(method='POST'), 405)
        self.assertEqual(fields['allow'], 'get')
        fx.decode(fx.request(method='HEAD'), 405, head=True)
        _, health = fx.decode(fx.request(target='/api/v1/health', fragments=True))
        self.assertEqual(health, {'status': 'ok'})
        # The process harness waits for the listener's log line; the logger
        # flushes asynchronously, so probe until the reactor signals readiness.
        deadline = time.monotonic() + 3
        while True:
            ready_response = fx.request(target='/api/v1/ready')
            if b' 503 ' not in ready_response.split(b'\r\n', 1)[0] or time.monotonic() >= deadline:
                break
            time.sleep(0.01)
        _, ready = fx.decode(ready_response)
        self.assertEqual(ready, {'status': 'ready'})
        fx.decode(fx.request(target='/api/v1/ready', auth=False), 401)
        fx.decode(fx.request(target='/api/v1/ready', method='POST'), 405)
        peer = hub.connect(); peer.sendall(b'HSUP ADBASE ADTIGR\n'); peer.shutdown(socket.SHUT_WR)
        drain_until_eof(peer)
        _, directory = fx.decode(fx.request(target='/api/v1/users'))
        self.assertEqual(directory, {'schema': 1, 'truncated': False, 'users': []})
        snapshot = fetch_status(fx.endpoint, fx.token)
        self.assertEqual(snapshot['api_version'], 'v1')
        self.assertEqual(snapshot['server']['version'], 'beta-0.4.7')
        self.assertTrue(snapshot['server']['core_running'])
        board = snapshot['dashboard']
        self.assertEqual(board['schema'], 1)
        self.assertEqual(board['core_running'], True)
        self.assertEqual(board['database_enabled'], False)
        self.assertEqual(board['uptime_seconds'], str(snapshot['server']['uptime_seconds']))
        self.assertEqual(board['adc_frames'], '1')
        self.assertEqual(board['connections_accepted'], str(snapshot['network']['accepted_connections']))
        self.assertEqual(board['connections_active'], str(snapshot['network']['active_connections']))
        self.assertEqual(board['bytes_received'], str(snapshot['network']['received_bytes']))
        self.assertEqual(board['bytes_sent'], str(snapshot['network']['sent_bytes']))
        self.assertEqual(board['users_online'], str(snapshot['users']['online']))
        self.assertEqual(board['chat_received'], str(snapshot['chat']['received']))
        self.assertEqual(board['search_queries'], str(snapshot['search']['statistics']['queries_received']))
        self.assertEqual(board['search_tracked'], str(snapshot['search']['statistics']['tracked_searches']))
        self.assertEqual(board['transfers_ctm'], str(snapshot['transfers']['statistics']['ctm_received']))
        self.assertEqual(board['transfers_rcm'], str(snapshot['transfers']['statistics']['rcm_received']))
        self.assertEqual(board['transfers_peer_unsupported'], str(snapshot['transfers']['statistics']['peer_protocol_unsupported']))
        self.assertEqual(board['transfers_peer_failed'], str(snapshot['transfers']['statistics']['peer_connection_failed']))
        self.assertEqual(board['kicks_succeeded'], snapshot['kick']['succeeded'])
        self.assertEqual(board['kicks_refused'], snapshot['kick']['refused'])
        self.assertEqual(board['mutes_applied'], snapshot['mute']['applied'])
        self.assertEqual(board['mutes_public_blocked'], snapshot['mute']['public_blocked'])
        self.assertEqual(board['mutes_private_blocked'], snapshot['mute']['private_blocked'])
        self.assertEqual(set(board), {
            'schema', 'core_running', 'database_enabled', 'uptime_seconds', 'users_online', 'users_peak',
            'users_logins', 'connections_active', 'connections_peak', 'connections_accepted', 'connections_rejected',
            'connections_closed', 'security_rejected', 'security_closed', 'adc_frames', 'adcs_handshakes',
            'bytes_received', 'bytes_sent', 'chat_received', 'chat_public', 'chat_private', 'chat_rejected',
            'chat_flood_limited', 'search_queries', 'search_routed', 'search_rejected', 'search_results',
            'search_tracked', 'transfers_ctm', 'transfers_rcm', 'transfers_peer_unsupported', 'transfers_peer_failed',
            'kicks_succeeded', 'kicks_refused', 'mutes_applied', 'mutes_public_blocked', 'mutes_private_blocked'})
        self.assertGreaterEqual(snapshot['network']['accepted_connections'], 1)
        self.assertEqual(snapshot['network']['adc_frames'], 1)
        self.assertEqual(snapshot['database'], {'enabled': False})
        self.assertEqual(snapshot['mute'],dict(attempts='0',applied='0',cleared='0',refused='0',errors='0',notice_failures='0',public_blocked='0',private_blocked='0'))
        public = snapshot['configuration']
        self.assertEqual(public['mode'], 'hub')
        self.assertTrue(public['restart_required'])
        self.assertEqual(public['database']['transport'], 'unix')
        self.assertEqual(public['database']['connect_timeout_seconds'], 5)
        self.assertEqual(public['authentication']['login_timeout_seconds'], 30)
        self.assertFalse(public['authentication']['enabled'])
        self.assertNotIn(str(fx.folder), json.dumps(snapshot))
        sample = snapshot['monitoring']
        self.assertEqual(set(sample), {
            'available', 'cpu_user_ms', 'cpu_system_ms', 'cpu_window_ms', 'cpu_delta_ms', 'rss_bytes',
            'sessions_accepted', 'sessions_negotiating', 'sessions_identified', 'sessions_ready',
            'sessions_closing', 'sessions_closed', 'sessions_created', 'sessions_completed',
            'login_samples', 'login_last_ms', 'login_max_ms',
            'reactor_samples', 'reactor_last_ms', 'reactor_max_ms'})
        self.assertIs(sample['available'], True)
        self.assertGreater(int(sample['rss_bytes']), 0)
        # Earlier API status/readiness requests may already have opened the
        # CPU sampling window. Its elapsed time is not deterministically zero.
        self.assertGreaterEqual(int(sample['cpu_window_ms']), 0)
        self.assertEqual(sample['login_samples'], '0')
        self.assertGreater(int(sample['reactor_samples']), 0)
        self.assertGreaterEqual(int(sample['reactor_max_ms']), int(sample['reactor_last_ms']))
        self.assertNotIn('/proc', json.dumps(snapshot))
        time.sleep(0.05)
        _, again = fx.decode(fx.request())
        self.assertGreaterEqual(int(again['monitoring']['cpu_window_ms']), 1)
        self.assertGreaterEqual(int(again['monitoring']['cpu_user_ms']), int(sample['cpu_user_ms']))
        self.assertGreaterEqual(int(again['monitoring']['cpu_system_ms']), int(sample['cpu_system_ms']))
        hub.stop(); self.assertFalse(fx.endpoint.exists())
        self.assertIn(b'Local API listening', hub.log)
        self.assertNotIn(fx.token.encode(), hub.log)
        self.assertNotIn(b'private-route', hub.log)
        self.assertNotIn(str(fx.folder).encode(), hub.log)
        fx.start().stop(signal.SIGINT)
        self.assertFalse(fx.endpoint.exists())

    def test_ready_user_directory_hides_identity_secrets(self):
        fx = Fixture(self)
        hub = fx.start()
        peer = Peer(self, hub.connect())
        peer.login(b'WebUser', 7)
        body = None
        deadline = time.time() + 2
        while time.time() < deadline:
            _, body = fx.decode(fx.request(target='/api/v1/users'))
            if body['users']:
                break
            time.sleep(0.05)
        self.assertEqual(body['schema'], 1)
        self.assertFalse(body['truncated'])
        self.assertEqual(len(body['users']), 1)
        row = body['users'][0]
        self.assertEqual(row['nickname'], 'WebUser')
        self.assertEqual(row['sid'], peer.sid.decode())
        self.assertEqual(row['transport'], 'adc')
        self.assertEqual(row['role'], 'guest')
        self.assertFalse(row['public_muted'])
        self.assertFalse(row['private_muted'])
        self.assertRegex(row['session'], r'^[1-9]\d{0,19}$')
        self.assertEqual(set(row), {'session', 'sid', 'nickname', 'transport', 'role', 'public_muted', 'private_muted'})
        encoded = json.dumps(body)
        self.assertNotIn(pair(7)[1].decode(), encoded)
        self.assertNotIn('password', encoded)
        self.assertNotIn('email', encoded)
        status = fetch_status(fx.endpoint, fx.token)
        self.assertNotIn('WebUser', json.dumps(status))
        fx.decode(fx.request(method='POST', target='/api/v1/users'), 405)
        hub.stop()

    def test_strict_framing_limits_and_recovery(self):
        fx = Fixture(self); fx.start()
        for headers, body in [
            ('Content-Length: 1\r\n', 'x'), ('Content-Length: 0\r\n', 'x'),
            ('Content-Length: 0\r\ncontent-length: 0\r\n', ''),
            ('Transfer-Encoding: chunked\r\nContent-Length: 0\r\n', ''),
            ('Authorization: Bearer ' + fx.token + '\r\n', ''), ('HOST: other\r\n', ''),
            ('Expect: 100-continue\r\n', ''), ('Upgrade: websocket\r\n', ''),
            (' Folded: bad\r\n', ''), ('Content-Length : 0\r\n', ''),
        ]:
            with self.subTest(headers=headers):
                fx.decode(fx.request(headers=headers, body=body), 400)
        for raw in [b'GET / HTTP/1.1\nHost: local\n\n', b'GET / HTTP/1.1\r\n\r\n',
                    b'GET / HTTP/1.1\r\nHost: local\r\nX: \x00\r\n\r\n',
                    b'GET / HTTP/1.1\r\nHost: local\r\nX: \xff\r\n\r\n']:
            fx.decode(fx.request(raw=raw), 400)
        prefix = ('GET /api/v1/health HTTP/1.1\r\nHost: local\r\nAuthorization: Bearer ' + fx.token + '\r\nX-Pad: ').encode()
        exact = prefix + b'a' * (8192 - len(prefix) - 4) + b'\r\n\r\n'
        fx.decode(fx.request(raw=exact))
        fx.decode(fx.request(raw=prefix + b'a' * 8192), 431)
        # Two requests in one received buffer never execute a second request.
        good = ('GET /api/v1/health HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ' + fx.token + '\r\n\r\n').encode()
        fx.decode(fx.request(raw=good + good), 400)
        fx.decode(fx.request(headers='Content-Length: 0\r\n'))
        self.assertEqual(fetch_status(fx.endpoint, fx.token)['network']['adc_frames'], 0)

    def test_multiple_clients_absolute_timeout_and_slot_recovery(self):
        fx = Fixture(self, 'max_connections=2\nrequest_timeout=1\n'); fx.start()
        first, second = fx.connect(), fx.connect()
        first.sendall(b'GET '); second.sendall(b'GET ')
        excess = fx.connect()
        try:
            self.assertEqual(excess.recv(1), b'')
        except ConnectionResetError:
            pass
        start = time.monotonic()
        while time.monotonic() - start < 1.4:
            try:
                first.sendall(b'x')
            except (BrokenPipeError, ConnectionResetError):
                break
            time.sleep(0.15)
        self.assertLess(time.monotonic() - start, 1.6)
        self.assertEqual(first.recv(1), b'')
        self.assertEqual(second.recv(1), b'')
        fx.decode(fx.request())
        fx.hub.stop()
        self.assertFalse(fx.endpoint.exists())
        # Many completed connections remain independent of ADC transport.
        parallel = Fixture(self); parallel.start()
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(pool.map(lambda _: parallel.request(), range(32)))
        for response in results:
            parallel.decode(response)
        held = parallel.connect(); held.sendall(b'GET ')
        parallel.hub.stop()
        # Shutdown can close before reading the prefix; EOF/reset both mean closed.
        try:
            self.assertEqual(held.recv(1), b'')
        except ConnectionResetError:
            pass

    def test_private_files_startup_checks_and_collision_protection(self):
        fx = Fixture(self)
        token_file = fx.folder / 'admin.token'
        def cli(*args):
            return subprocess.run([BINARY, '--config', str(fx.ini), *args], capture_output=True, timeout=5)
        def rejected():
            result = cli()
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertNotIn(fx.token.encode(), result.stderr)
            self.assertNotIn(str(fx.folder).encode(), result.stderr)
            self.assertNotIn(b'Network listening on', result.stderr)
            self.assertFalse(fx.endpoint.exists())
        token_file.chmod(0o644)
        self.assertEqual(cli('--check-config').returncode, 0)  # No credential read or socket creation.
        rejected(); token_file.chmod(0o600)
        original = token_file.read_bytes()
        for data in [b'', b'a' * 63, b'g' * 64, b'a' * 65, b'a' * 4097, b'a' * 32 + b'\x00' + b'a' * 31]:
            token_file.write_bytes(data); rejected()
        token_file.write_bytes(original)
        for destination in [token_file, fx.ini, fx.endpoint]:
            result = cli('--log-file', str(destination), '--check-config')
            self.assertEqual(result.returncode, 2, result.stderr)
        alias = fx.folder / 'alias.token'; os.link(token_file, alias)
        self.assertEqual(cli('--log-file', str(alias), '--check-config').returncode, 2)
        rejected(); alias.unlink()
        # Existing regular files, symlinks and stale sockets must never be replaced/unlinked.
        fx.endpoint.write_text('KEEP')
        self.assertEqual(cli().returncode, 1); self.assertEqual(fx.endpoint.read_text(), 'KEEP')
        fx.endpoint.unlink(); fx.endpoint.symlink_to(token_file)
        self.assertEqual(cli().returncode, 2); self.assertTrue(fx.endpoint.is_symlink())
        fx.endpoint.unlink()
        with socket.socket(socket.AF_UNIX) as stale:
            stale.bind(str(fx.endpoint))
        self.assertEqual(cli().returncode, 1); self.assertTrue(fx.endpoint.exists())
        fx.endpoint.unlink()
        fx.folder.chmod(0o755); rejected(); fx.folder.chmod(0o700)
        token_file.write_text('invalid')
        result = cli('--language', 'pl')
        self.assertEqual(result.returncode, 1)
        self.assertIn('Token API musi'.encode(), result.stderr)
        token_file.write_bytes(original)
        # Failed Network startup rolls back an already bound API socket.
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1', 0)); occupied.listen()
            result = cli('--listen', '127.0.0.1:' + str(occupied.getsockname()[1]))
            self.assertEqual(result.returncode, 1)
            self.assertFalse(fx.endpoint.exists())

    @unittest.skipUnless(os.geteuid() == 0, 'Cross-UID fixture needs root; filesystem isolation is always tested')
    def test_peer_uid_even_if_permissions_are_relaxed_after_start(self):
        fx = Fixture(self); fx.start()
        fx.folder.chmod(0o755); fx.endpoint.chmod(0o666)
        script = """import socket,sys
peer=socket.socket(socket.AF_UNIX); peer.settimeout(2); peer.connect(sys.argv[1])
try:
    peer.sendall(sys.stdin.buffer.read())
    data=peer.recv(4096)
except (BrokenPipeError,ConnectionResetError):
    data=b''
peer.close()
assert b'HTTP/1.1 200' not in data
"""
        def demote():
            os.setgroups([]); os.setgid(65534); os.setuid(65534)
        request = ('GET /api/v1/health HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ' + fx.token + '\r\n\r\n').encode()
        child = subprocess.run([sys.executable, '-c', script, str(fx.endpoint)], input=request,
                               capture_output=True, timeout=5, preexec_fn=demote)
        self.assertEqual(child.returncode, 0, child.stderr)
        fx.folder.chmod(0o700); fx.endpoint.chmod(0o600)
        fx.decode(fx.request())

    def test_configuration_and_disabled_defaults(self):
        fx = Fixture(self)
        base = fx.ini.read_text()
        for text in [base + 'port=1234\n', base + 'max_connections=0\n', base + 'request_timeout=31\n',
                     base.replace('enabled=on', 'enabled=wrong'), base.replace('socket=', 'unknown='),
                     base.replace('token_file=', 'token='), base + 'enabled=on\n']:
            fx.ini.write_text(text)
            result = subprocess.run([BINARY, '--config', str(fx.ini), '--check-config'], capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 2, result.stderr)
        fx.ini.write_text('[network]\nlisten=127.0.0.1:0\n[api]\nenabled=off\ntoken_file=missing.token\n')
        hub = fx.start(); self.assertFalse(fx.endpoint.exists()); hub.stop()
        self.assertNotIn(b'Local API listening', hub.log)
        fx.ini.write_text(base.replace(str(fx.endpoint), 'admin.sock').replace(str(fx.folder / 'admin.token'), 'admin.token'))
        hub = fx.start('--language', 'pl')
        fx.decode(fx.request())
        hub.process.send_signal(signal.SIGTERM)
        out, err = hub.process.communicate(timeout=3)
        hub.log.extend(err)
        self.assertEqual(hub.process.returncode, 0, hub.log)
        self.assertIn('Lokalne API nasłuchuje'.encode(), hub.log)
        self.assertFalse(fx.endpoint.exists())


if __name__ == '__main__':
    unittest.main()
