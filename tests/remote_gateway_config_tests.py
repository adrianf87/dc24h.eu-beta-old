#!/usr/bin/env python3
"""Remote beta-0.4.6 gateway invariants, including HTTPS and systemd sandbox."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class RemoteConfiguration(unittest.TestCase):
    def text(self, path):
        return (ROOT / path).read_text(encoding="utf-8")

    def test_separate_https_loopback_only(self):
        config = self.text("config/apache2-webadmin-remote.conf.example")
        self.assertIn("Listen 127.0.0.1:8443", config)
        self.assertIn("<VirtualHost 127.0.0.1:8443>", config)
        self.assertIn("Require local", config)
        self.assertIn("SSLEngine On", config)
        self.assertIn("SSLProtocol -all +TLSv1.2 +TLSv1.3", config)
        self.assertIn('SSLCipherSuite "ECDHE+AESGCM:ECDHE+CHACHA20:', config)
        self.assertIn("SSLHonorCipherOrder On", config)
        self.assertIn("SSLCompression Off", config)
        self.assertIn("SSLSessionTickets Off", config)
        self.assertIn("ProxyAddHeaders Off", config)
        self.assertIn("MergeSlashes Off", config)
        self.assertIn("RewriteEngine On", config)
        self.assertIn("RewriteCond %{HTTP_HOST} !^localhost:8443$ [NC]", config)
        self.assertIn("RewriteCond %{QUERY_STRING} !^$", config)
        self.assertIn("RewriteCond %{REQUEST_METHOD} !^GET$", config)
        self.assertIn("RewriteCond %{REQUEST_METHOD} !^POST$", config)
        self.assertIn("RewriteCond %{HTTP:Origin} !^https://localhost:8443$", config)
        self.assertIn("RewriteCond %{HTTP:Sec-Fetch-Site} !^(?:same-origin|none)$", config)
        self.assertIn("LimitRequestBody 2048", config)
        self.assertIn("RewriteCond %{HTTP:Content-Length} -gt2048", config)
        self.assertIn("RewriteCond %{HTTP:Content-Length} !^[0-9]{1,4}$", config)
        self.assertIn("RewriteCond %{HTTP:Transfer-Encoding} !^$", config)
        self.assertIn("RewriteCond %{HTTP:Content-Length} !^(?:0)?$", config)
        self.assertIn("RewriteCond %{REQUEST_URI} ^/remote/v1/(?:challenge|session|summary|passkey/devices)$", config)
        self.assertIn("LimitRequestBody 32768", config)
        self.assertIn("RewriteCond %{HTTP:Content-Length} -gt32768", config)
        self.assertIn("passkey/(?:login/(?:options|finish)|enroll/(?:options|finish)|device/(?:rename|revoke))", config)
        self.assertIn('<Files "index.html">', config)
        self.assertIn('^local-[A-Za-z0-9_-]+', config)
        self.assertIn("ProxyPassMatch", config)
        self.assertIn("challenge|login|session|summary|logout", config)
        self.assertNotIn("ProxyPass \"/\"", config)
        self.assertIn("Require all denied", config)
        for path in ("admin-api", "api", "management"):
            self.assertIn(path, config)
        for header in ("Authorization", "Proxy-Authorization", "X-DC24H-Admin-Grant", "X-DC24H-Session",
                       "X-DC24H-Csrf", "Forwarded", "X-Forwarded-For", "X-Forwarded-Port",
                       "X-Forwarded-Prefix", "X-Forwarded-User", "X-Original-URL", "X-Rewrite-URL"):
            self.assertIn("RequestHeader unset " + header, config)
        self.assertIn("frame-ancestors 'none'", config)
        self.assertIn("Cache-Control \"no-store\"", config)
        self.assertIn('Cross-Origin-Opener-Policy "same-origin"', config)
        self.assertIn('Cross-Origin-Resource-Policy "same-origin"', config)
        self.assertIn('Permissions-Policy "camera=()', config)

    def test_systemd_sample_rejects_nonlocal_traffic(self):
        unit = self.text("config/dc24h-remote-gateway.service.example")
        for expected in ("DC24H_REMOTE_ORIGIN=https://localhost:8443",
                         "DC24H_REMOTE_PORT=4182", "IPAddressDeny=any",
                         "StateDirectory=dc24h-remote", "StateDirectoryMode=0700",
                         "DC24H_REMOTE_MFA_FILE=/var/lib/dc24h-remote/mfa.json",
                         "DC24H_REMOTE_MFA_REPLAY_FILE=/var/lib/dc24h-remote/replay.jsonl",
                         "IPAddressAllow=localhost", "NoNewPrivileges=true",
                         "ProtectSystem=strict", "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
                         "PrivateDevices=true", "ProtectKernelTunables=true",
                         "ProtectKernelModules=true", "ProtectKernelLogs=true",
                         "ProtectControlGroups=true", "ProtectClock=true",
                         "ProtectHostname=true", "ProtectProc=invisible",
                         "RestrictNamespaces=true", "RestrictSUIDSGID=true",
                         "RestrictRealtime=true", "LockPersonality=true",
                         "SystemCallArchitectures=native",
                         "CapabilityBoundingSet=", "AmbientCapabilities="):
            self.assertIn(expected, unit)
        self.assertNotIn("DC24H_REMOTE_PUBLIC=", unit)
        self.assertNotIn("PrivateNetwork=true", unit)
        self.assertNotIn("MemoryDenyWriteExecute=true", unit)

    def test_gateway_in_process_permissions_and_boundaries(self):
        code = self.text("webadmin/server/remote-gateway.ts")
        self.assertIn("parseRemoteSummary", code)
        self.assertNotIn("parseSnapshot", code)
        for expected in ("/api/v1/admin/access", "/api/v1/management",
                         "/api/v1/status", '"administrator"', '"owner"',
                         "parseManagement", "sameSecret", "randomBytes",
                         "SameSite=Strict", "HttpOnly; Secure", "maxSessions = 4",
                         "absoluteTime = 10 * 60_000", "idleTime = 2 * 60_000",
                         "api_unavailable", "session_revoked", "login_refused",
                         "mfaVerify", "mfaVerified", "mfa_ok", "mfa_refused",
                         "no-store", "login:global", "authorization", "untrustedProxyHeader",
                         'name.startsWith("x-forwarded-")', 'name === "proxy-authorization"'):
            self.assertIn(expected, code)
        self.assertIn("signal: AbortSignal.timeout(4000)", code)
        self.assertIn('isJsonContentType(answer.headers["content-type"])', code)
        self.assertIn('answer.on("close", scrub)', code)
        for forbidden in ("/api/v1/management/configuration/write",
                          "/api/v1/management/hub/start",
                          "child_process", "exec(", "localStorage", "sessionStorage"):
            self.assertNotIn(forbidden, code)
        executable = self.text("webadmin/server/remote-main.ts")
        self.assertIn('app.listen(port, "127.0.0.1"', executable)
        self.assertIn("DC24H_REMOTE_ORIGIN", executable)
        self.assertIn("DC24H_REMOTE_PUBLIC", executable)
        self.assertIn("credentials(process.env)", executable)
        self.assertIn("loadTotpVerifier", executable)
        self.assertIn("mfaVerify: mfa.verify", executable)
        self.assertIn("DC24H_REMOTE_PASSKEY_FILE", executable)
        self.assertIn("DC24H_REMOTE_RP_ID", executable)
        verifier = self.text("webadmin/server/remote-mfa.ts")
        for expected in ("timingSafeEqual", "O_NOFOLLOW", "fsyncSync", "lastUsed", "0o600", "ledgerLimit"):
            self.assertIn(expected, verifier)

    def test_no_new_migration_and_separate_ui(self):
        ui = self.text("webadmin/src/remote/RemoteApp.tsx")
        self.assertIn("X-DC24H-Remote-CSRF", ui)
        self.assertIn('call("logout"', ui)
        self.assertIn('call("summary"', ui)
        self.assertIn('s.mfa === true', ui)
        self.assertIn('name="otp"', ui)
        self.assertNotIn("localStorage", ui)
        self.assertNotIn("sessionStorage", ui)
        self.assertNotIn("Start/Stop/Restart", ui)
        self.assertIn('remote.html', self.text("webadmin/vite.config.ts"))
        self.assertIn('set(DC24H_VERSION "beta-0.4.6")', self.text("CMakeLists.txt"))
        self.assertIn('WEBADMIN_VERSION = "beta-0.4.6"', self.text("webadmin/src/lib/status.ts"))
        self.assertIn("beta-0.2-code", self.text(".github/workflows/build.yml"))
        self.assertIn("beta-0.2.2-fix", self.text(".github/workflows/build.yml"))
        self.assertIn("beta-0.2.2-source", self.text(".github/workflows/build.yml"))
        self.assertIn("remote.gateway.config", self.text("CMakeLists.txt"))
        self.assertIn("apache2.remote.gateway", self.text("CMakeLists.txt"))
        self.assertIn("remote.pilot.preflight", self.text("CMakeLists.txt"))
        self.assertEqual(len(list((ROOT / "database/migrations").glob("*.sql"))), 11)


if __name__ == "__main__":
    unittest.main()
