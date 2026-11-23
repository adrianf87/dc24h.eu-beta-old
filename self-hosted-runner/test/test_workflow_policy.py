"""Offline contract for bounded self-hosted Docker CI and manual five-distro runs."""

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
        self.assertIn("runs-on: [self-hosted, Linux, X64, server-747585786]", workflow)
        self.assertIn("persist-credentials: false", workflow)
        self.assertNotIn("  push:\n", workflow)
        self.assertNotIn("pull_request:", workflow)
        self.assertNotIn("pull_request_target:", workflow)

    def test_resource_limits_are_real_affinity_not_cpu_time(self):
        host = self.text("self-hosted-runner/test/run-matrix.sh")
        container = self.text("self-hosted-runner/test/run-in-container.sh")
        self.assertIn('--cpuset-cpus "$cpuset"', host)
        self.assertIn("--memory 32g --memory-swap 32g", host)
        self.assertNotIn(" --cpus ", host)
        self.assertNotIn(" --cpu-quota", host)
        self.assertIn('[[ "$(nproc)" == 16 ]]', container)
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

    def test_all_regular_ci_jobs_use_the_debian_13_runner_and_ubuntu_containers(self):
        runner = "runs-on: [self-hosted, Linux, X64, server-747585786]"
        limits = "--cpuset-cpus=0-15 --memory=32g --memory-swap=32g"
        for name, jobs, containers in (
            ("build.yml", 4, 3),
            ("stage4-ubuntu-vm-validation.yml", 1, 1),
        ):
            with self.subTest(workflow=name):
                workflow = self.text(".github/workflows/" + name)
                self.assertEqual(workflow.count(runner), jobs)
                self.assertEqual(workflow.count(limits), containers)
                self.assertNotIn("runs-on: ${{ matrix.os }}", workflow)
                self.assertNotRegex(workflow, r"runs-on:\s*ubuntu-\d")
                self.assertIn("github.actor == 'adrianf87'", workflow)
                self.assertIn("github.event.pull_request.head.repo.full_name == github.repository", workflow)
                for image in ("ubuntu:22.04", "ubuntu:24.04", "ubuntu:26.04"):
                    self.assertIn(image, workflow)

        installer = self.text(".github/scripts/install-ci-deps.sh")
        self.assertIn("if (( EUID != 0 )); then", installer)
        self.assertIn('run_as_root=(sudo)', installer)


if __name__ == "__main__":
    unittest.main()
