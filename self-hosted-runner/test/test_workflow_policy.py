"""Offline contract: privileged self-hosted jobs must remain opt-in and bounded."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]


class RunnerPolicy(unittest.TestCase):
    def text(self, relative):
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_no_pull_request_and_confirmed_manual_opt_in(self):
        workflow = self.text(".github/workflows/self-hosted-debian13-docker.yml")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("default: 'DISABLED'", workflow)
        self.assertIn("inputs.confirm_run == 'RUN-FIVE-DISTROS'", workflow)
        self.assertIn("github.actor == 'adrianf87'", workflow)
        self.assertIn("runs-on: [self-hosted, Linux, X64, server-759505093]", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertNotIn("  push:\n", workflow)
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("pull_request_target:", workflow)

    def test_resource_limits_are_real_affinity_not_cpu_time(self):
        host = self.text("self-hosted-runner/test/run-matrix.sh")
        container = self.text("self-hosted-runner/test/run-in-container.sh")
        self.assertIn('--cpuset-cpus "$cpuset"', host)
        self.assertIn("--memory 8g --memory-swap 8g", host)
        self.assertNotIn(" --cpus ", host)
        self.assertNotIn(" --cpu-quota", host)
        self.assertIn('[[ "$(nproc)" == 8 ]]', container)
        self.assertIn('[[ "$cpu_quota" == max ]]', container)
        self.assertIn('--mount "type=bind,src=$GITHUB_WORKSPACE,dst=/src,readonly"', host)
        self.assertNotIn('/var/run/docker.sock', host)
        self.assertNotIn('--privileged', host)

    def test_exact_five_distributions_sequential_and_no_host_sudo(self):
        host = self.text("self-hosted-runner/test/run-matrix.sh")
        container = self.text("self-hosted-runner/test/run-in-container.sh")
        for name, image in (("debian-12", "debian:12"), ("debian-13", "debian:13"),
                            ("ubuntu-22.04", "ubuntu:22.04"), ("ubuntu-24.04", "ubuntu:24.04"),
                            ("ubuntu-26.04", "ubuntu:26.04")):
            self.assertIn(name, host)
            self.assertIn(image, host)
            self.assertIn(name + ")", container)
        self.assertIn('for index in "${!distros[@]}"', host)
        self.assertNotIn('sudo ', host)
        self.assertIn("ctest.xml", container)
        self.assertIn("test:e2e", container)
        self.assertIn("test:integration", container)


if __name__ == "__main__":
    unittest.main()
