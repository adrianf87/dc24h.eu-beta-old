"""Source safety contract for beta 0.4.1–0.4.4, not a deployment approval."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class StageOneGate(unittest.TestCase):
    def test_release_and_hosted_ci(self):
        self.assertIn('set(DC24H_VERSION "beta-0.4.7")', read("CMakeLists.txt"))
        self.assertIn('WEBADMIN_VERSION = "beta-0.4.7"', read("webadmin/src/lib/status.ts"))
        workflow = read(".github/workflows/build.yml")
        for expected in ("beta-0.4.1-0.4.4-stage1", "ubuntu-22.04", "ubuntu-24.04", "ubuntu-26.04",
                         "ctest --test-dir", "npm audit --omit=dev --audit-level=high",
                         "sanitizer: [address, undefined]", "pull_request:"):
            self.assertIn(expected, workflow)
        self.assertIn("beta.04.stage1", read("CMakeLists.txt"))

    def test_mfa_rotation_is_private_and_replay_is_not_rewound(self):
        mfa = read("webadmin/server/remote-mfa.ts")
        for expected in ("replaceTotpSecret", "compactTotpReplay", "renameSync(tmp, enrollmentPath)", "fsyncSync(dirFd)",
                         "MFA enrollment changed; restart required", "visitReplayLedger", "oldCode",
                         "offlineAcknowledged"):
            self.assertIn(expected, mfa)
        tool = read("webadmin/server/remote-mfa-tool.ts")
        for expected in ("--offline-ack", "--recovery", "--compact-replay", "Unsafe maintenance request", "replaceTotpSecret"):
            self.assertIn(expected, tool)
        self.assertNotIn("child_process", read("webadmin/server/remote-gateway.ts"))
        self.assertEqual(len(list((ROOT / "database/migrations").glob("*.sql"))), 11)

    def test_audit_is_durable_private_and_authentication_fails_closed(self):
        store = read("webadmin/server/remote-audit-store.ts")
        for expected in ("O_NOFOLLOW", "0o600", "fsyncSync(fd)", "previous", "sequence",
                         "sha256", "maxBytes", "dropped", "lstatSync"):
            self.assertIn(expected, store)
        main = read("webadmin/server/remote-main.ts")
        for expected in ("DC24H_REMOTE_AUDIT_FILE", "openRemoteAuditStore", "strictAudit: true",
                         "auditHealthy", "AUDIT_LOSS", 'app.listen(port, "127.0.0.1"'):
            self.assertIn(expected, main)
        gateway = read("webadmin/server/remote-gateway.ts")
        self.assertIn('new Set(["challenge", "login", "session", "summary", "logout", "passkey/devices", ...passkeyPost])', gateway)
        self.assertIn('sessions.clear(); challenges.clear();', gateway)
        self.assertIn('options.strictAudit && (!mfaLogged || !loginLogged)', gateway)
        service = read("config/dc24h-remote-gateway.service.example")
        self.assertIn("DC24H_REMOTE_AUDIT_FILE", service)
        self.assertNotIn("0.0.0.0:8443", read("config/apache2-webadmin-remote.conf.example"))

    def test_documented_boundaries_and_operator_policy(self):
        for path in ("doc/us/BETA_0.4_STAGE_I.md", "doc/pl/BETA_0.4_STAGE_I.md"):
            body = read(path)
            for expected in ("beta-0.4.1", "beta-0.4.2", "beta-0.4.3", "beta-0.4.4",
                             "WebAuthn", "TOTP", "replay", "0700", "0600", "AUDIT_LOSS", "8 MiB"):
                self.assertIn(expected, body, path)


if __name__ == "__main__":
    unittest.main()
