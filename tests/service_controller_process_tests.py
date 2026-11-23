#!/usr/bin/env python3
"""Exercise the independent service controller with no hub process."""
import json
import os
from pathlib import Path
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest


CONTROLLER = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else None
sys.argv = [sys.argv[0], *sys.argv[2:]]


def request(path, payload=b"STATUS\n"):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(5)
        client.connect(str(path))
        client.sendall(payload)
        result = client.recv(4096)
        if result.startswith(b"{"):
            return json.loads(result)
        return result.decode("ascii")


class ControllerProcessTests(unittest.TestCase):
    def test_status_without_hub_and_denial_of_actions(self):
        with tempfile.TemporaryDirectory(prefix="dc24h-control-") as directory:
            root = Path(directory)
            root.chmod(0o700)
            path = root / "status.sock"
            process = subprocess.Popen([str(CONTROLLER), "--socket", str(path)],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            try:
                for _ in range(100):
                    if process.poll() is not None:
                        break
                    if path.exists():
                        try:
                            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as probe:
                                probe.connect(str(path))
                                break
                        except ConnectionRefusedError:
                            pass
                    time.sleep(0.02)
                self.assertIsNone(process.poll(), process.stderr.read().decode() if process.poll() is not None else "")
                self.assertTrue(stat.S_ISSOCK(path.lstat().st_mode))
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o660)

                response = request(path)
                self.assertEqual(response["schema"], 1)
                if response["available"]:
                    self.assertEqual(response["unit"], "dc24h.service")
                    self.assertIn(response["active_state"],
                                  ("active", "inactive", "failed", "activating", "deactivating", "reloading"))
                else:
                    self.assertIn(response["error"], ("systemd_unavailable", "invalid_systemd_response"))
                for payload in (b"START\n", b"STOP\n", b"RESTART\n",
                                b"STATUS dc24h-other.service\n", b"STATUS\n\x00", b"X" * 64):
                    self.assertEqual(request(path, payload), "ERROR unauthorized\n")
                self.assertEqual(request(path), response)

                # A valid Unix stream command may arrive in more than one
                # read; the controller must wait for the bounded newline.
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as fragmented:
                    fragmented.settimeout(5)
                    fragmented.connect(str(path))
                    fragmented.sendall(b"STA")
                    time.sleep(0.05)
                    fragmented.sendall(b"TUS\n")
                    self.assertEqual(json.loads(fragmented.recv(4096)), response)

                duplicate = subprocess.run([str(CONTROLLER), "--socket", str(path)],
                                           capture_output=True, timeout=5)
                self.assertNotEqual(duplicate.returncode, 0)
                self.assertEqual(request(path), response)
            finally:
                process.send_signal(signal.SIGTERM)
                process.wait(timeout=5)
                if process.stderr:
                    process.stderr.close()
            self.assertFalse(path.exists())

    def test_refuses_to_replace_inaccessible_live_socket(self):
        with tempfile.TemporaryDirectory(prefix="dc24h-control-") as directory:
            root = Path(directory)
            root.chmod(0o700)
            path = root / "status.sock"
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as listener:
                listener.bind(str(path))
                listener.listen(1)
                path.chmod(0o000)
                attempted = subprocess.run([str(CONTROLLER), "--socket", str(path)],
                                           capture_output=True, timeout=5)
                self.assertNotEqual(attempted.returncode, 0)
                self.assertTrue(path.exists())
                self.assertTrue(stat.S_ISSOCK(path.lstat().st_mode))
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o000)

    def test_rejects_untrusted_socket_path(self):
        with tempfile.TemporaryDirectory(prefix="dc24h-control-") as directory:
            root = Path(directory)
            root.chmod(0o700)
            path = root / "status.sock"
            target = root / "valuable.ini"
            target.write_text("do not change", encoding="utf-8")
            path.symlink_to(target)
            result = subprocess.run([str(CONTROLLER), "--socket", str(path)],
                                    capture_output=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b"unsafe socket path", result.stderr)
            self.assertTrue(path.is_symlink())
            self.assertEqual(target.read_text(encoding="utf-8"), "do not change")

            path.unlink()
            root.chmod(0o777)
            result = subprocess.run([str(CONTROLLER), "--socket", str(path)],
                                    capture_output=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(path.exists())

    def test_version_and_invalid_arguments(self):
        version = subprocess.run([str(CONTROLLER), "--version"],
                                 capture_output=True, text=True, timeout=5)
        self.assertEqual(version.stdout.strip(), "dc24h-service-controller beta-0.4.6")
        self.assertEqual(version.returncode, 0)
        self.assertNotEqual(subprocess.run([str(CONTROLLER), "--unit", "sshd.service"],
                                           capture_output=True, timeout=5).returncode, 0)


if __name__ == "__main__":
    unittest.main()
