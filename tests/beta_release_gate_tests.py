"""Non-deploying beta-0.4.8 guardrails, retaining beta-0.3 release history.

This is a deterministic source review gate, NOT a replacement for hosted CI,
real HTTPS/service integration, an operational penetration test or sign-off.
"""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
VERSION = "beta-0.4.8"


def source(path):
    return (ROOT / path).read_text(encoding="utf-8")


class BetaReleaseGate(unittest.TestCase):
    def test_version_and_ci_gate_are_consistent(self):
        self.assertIn(f'set(DC24H_VERSION "{VERSION}")', source("CMakeLists.txt"))
        self.assertIn(f'WEBADMIN_VERSION = "{VERSION}"', source("webadmin/src/lib/status.ts"))
        self.assertIn(f'version: "{VERSION}"', source("webadmin/tests/fixtures.ts"))
        self.assertIn(f"Current development version: {VERSION}", source("README.md"))
        cmake = source("CMakeLists.txt")
        for check in ("beta.baseline", "remote.gateway.config", "remote.pilot.preflight",
                      "beta.release.gate"):
            self.assertIn(f"add_test(NAME {check} ", cmake)
        workflow = source(".github/workflows/build.yml")
        for check in ("ctest --test-dir", "tests/*.test.ts", "npm run test:e2e",
                      "npm run test:integration", "npm audit --omit=dev --audit-level=high",
                      "sanitizer: [address, undefined]", "needs: [cpp, webadmin, sanitizers]"):
            self.assertIn(check, workflow)

    def test_local_only_fixed_routes_no_public_admin_api(self):
        gateway = source("webadmin/server/remote-gateway.ts")
        self.assertIn('new Set(["challenge", "login", "session", "summary", "logout", "passkey/devices", ...passkeyPost])', gateway)
        self.assertIn('mfaVerified !== true', gateway)
        self.assertNotIn('"/api/v1/management/configuration/write"', gateway)
        self.assertNotIn('"/api/v1/management/hub/start"', gateway)
        main = source("webadmin/server/remote-main.ts")
        self.assertIn('app.listen(port, "127.0.0.1"', main)
        self.assertIn("Public remote gateway is disabled", main)
        self.assertIn("mfaVerify: mfa.verify", main)
        https = source("config/apache2-webadmin-remote.conf.example")
        self.assertIn("Listen 127.0.0.1:8443", https)
        self.assertIn("ProxyRequests Off", https)
        self.assertIn("Require local", https)
        self.assertNotIn("0.0.0.0:8443", https)
        public = source("config/apache2-webadmin-https.conf.example")
        self.assertNotIn("/remote/v1/", public)
        self.assertNotIn("ProxyPass /remote", public)
        self.assertEqual(len(list((ROOT / "database/migrations").glob("*.sql"))), 11)

    def test_mfa_and_fixed_audit_security_controls_remain(self):
        mfa = source("webadmin/server/remote-mfa.ts")
        for expected in ("O_NOFOLLOW", "0o600", "fsyncSync", "lastUsed", "timingSafeEqual"):
            self.assertIn(expected, mfa)
        audit = source("webadmin/server/remote-audit.ts")
        for event in ("login_ok", "login_refused", "mfa_ok", "mfa_refused", "logout",
                      "session_revoked", "route_refused", "api_unavailable"):
            self.assertIn('"' + event + '"', audit)
        self.assertIn('component: "remote-gateway"', audit)
        self.assertNotIn('actor_id:', audit)
        self.assertNotIn('password:', audit)
        self.assertIn("remoteAuditRecord(event, Date.now())", source("webadmin/server/remote-main.ts"))

    def test_operator_gate_declares_residual_risks_and_no_automatic_release(self):
        for path, phrases in (
            ("doc/us/RELEASE_BETA_0.3.md", ("beta-0.3.12", "CI", "MFA", "rollback", "manual")),
            ("doc/pl/RELEASE_BETA_0.3.md", ("beta-0.3.12", "CI", "MFA", "wycofanie", "ręczna")),
        ):
            text = source(path)
            for phrase in phrases:
                self.assertIn(phrase, text, path)
        self.assertIn("--ca-file", source("scripts/remote_pilot_check.py"))


if __name__ == "__main__":
    unittest.main()
