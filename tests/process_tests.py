"""Black-box CLI and real process-signal tests; standard library only."""
import os
import selectors
import signal
import subprocess
import sys
import time
import unittest

BINARY = os.path.abspath(sys.argv.pop(1))


class ProcessTests(unittest.TestCase):
    def cli(self, *args):
        return subprocess.run(
            [BINARY, *args], capture_output=True, text=True, timeout=5, check=False
        )

    def test_version(self):
        result = self.cli("--version")
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "dc24h.eu beta-0.4.7\n")
        self.assertEqual(result.stderr, "")

    def test_help(self):
        result = self.cli("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("SIGTERM", result.stdout)
        self.assertEqual(result.stderr, "")

    def test_language_help_validation_and_lifecycle(self):
        result = self.cli('--language', 'pl', '--help')
        self.assertEqual(result.returncode, 0)
        self.assertIn('Użycie:', result.stdout)
        self.assertIn('Usage:', self.cli('--language', 'us', '--help').stdout)
        self.assertEqual(self.cli('--help', '--language', 'pl').stdout, result.stdout)
        for args in [('--language',), ('--language', 'de'), ('--language', 'pl', '--listen')]:
            with self.subTest(args=args):
                self.assertEqual(self.cli(*args).returncode, 2)
        self.assertIn('Nieprawidłowe argumenty', self.cli('--language', 'pl', '--unknown').stderr)
        process = subprocess.Popen([BINARY, '--language', 'pl', '--listen', '127.0.0.1:0'],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        self.addCleanup(self.cleanup_process, process)
        log = bytearray()
        with selectors.DefaultSelector() as selector:
            selector.register(process.stderr, selectors.EVENT_READ)
            deadline = time.monotonic() + 5
            while 'Sieć nasłuchuje na'.encode() not in log:
                remaining = deadline - time.monotonic()
                self.assertGreater(remaining, 0, repr(log))
                self.assertTrue(selector.select(remaining))
                chunk = os.read(process.stderr.fileno(), 4096)
                self.assertTrue(chunk, repr(log))
                log.extend(chunk)
        process.send_signal(signal.SIGTERM)
        stdout, stderr = process.communicate(timeout=3)
        log.extend(stderr)
        self.assertEqual(process.returncode, 0, log.decode())
        self.assertEqual(stdout, b'')
        self.assertIn('Core zatrzymany', log.decode())
        self.assertNotIn('Core stopped', log.decode())

    def test_invalid_arguments(self):
        for args in [("--unknown",), ("--help", "extra"), ("--version", "extra")]:
            with self.subTest(args=args):
                result = self.cli(*args)
                self.assertEqual(result.returncode, 2)
                self.assertIn("Invalid arguments", result.stderr)
                self.assertEqual(result.stdout, "")

    def run_and_stop(self, signals, ready_marker=b"Core running"):
        # Unbuffered binary reads avoid readline blocking and text-buffer/select races.
        process = subprocess.Popen(
            [BINARY, "--listen", "127.0.0.1:0"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0
        )
        self.addCleanup(self.cleanup_process, process)
        log = bytearray()
        deadline = time.monotonic() + 5
        with selectors.DefaultSelector() as selector:
            selector.register(process.stderr, selectors.EVENT_READ)
            while ready_marker not in log:
                remaining = deadline - time.monotonic()
                self.assertGreater(remaining, 0, bytes(log).decode(errors="replace"))
                self.assertTrue(selector.select(remaining), "Startup timed out")
                chunk = os.read(process.stderr.fileno(), 4096)
                self.assertTrue(chunk, "Process exited before startup: " + repr(bytes(log)))
                log.extend(chunk)

        self.assertIsNone(process.poll(), "Core must remain running until stop requested")
        for sig in signals:
            try:
                os.kill(process.pid, sig)
            except ProcessLookupError:
                break  # Shutdown may finish before a repeated signal can be sent.
        stdout, stderr = process.communicate(timeout=5)
        log.extend(stderr)
        text = log.decode()
        self.assertEqual(process.returncode, 0, text)
        self.assertEqual(stdout, b"")
        self.assertEqual(text.count("Core stopping"), 1, text)
        self.assertEqual(text.count("Core stopped"), 1, text)
        self.assertIn("Received SIG", text)
        self.assertLess(text.index("Core stopping"), text.index("Core stopped"))
        return text

    @staticmethod
    def cleanup_process(process):
        if process.poll() is None:
            process.kill()
        process.communicate()

    def test_sigint(self):
        self.assertIn("Received SIGINT", self.run_and_stop([signal.SIGINT]))

    def test_sigterm(self):
        self.assertIn("Received SIGTERM", self.run_and_stop([signal.SIGTERM]))

    def test_signal_during_startup(self):
        # The startup log is written after blocking signals, before creating the waiter.
        for _ in range(10):
            self.run_and_stop([signal.SIGTERM], ready_marker=b"Starting dc24h.eu")

    def test_repeated_signals(self):
        for _ in range(10):
            self.run_and_stop([signal.SIGTERM, signal.SIGINT] * 10)


if __name__ == "__main__":
    unittest.main()
