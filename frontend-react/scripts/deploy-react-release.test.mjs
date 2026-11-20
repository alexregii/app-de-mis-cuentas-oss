import {afterEach, describe, expect, it} from "vitest";
import {mkdtempSync, mkdirSync, writeFileSync, copyFileSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, {recursive: true, force: true}); });
function runRelease(overrides = {}, args = ["candidate-test", "approved-baseline"]) {
  const root = mkdtempSync(path.join(tmpdir(), "react-release-"));
  directories.push(root);
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, "bin"));
  const script = path.join(root, "scripts/deploy_react_release.sh");
  copyFileSync(path.resolve("../scripts/deploy_react_release.sh"), script);
  const executable = (name, body) => writeFileSync(path.join(root, "bin", name), `#!/bin/sh\nset -eu\n${body}\n`, {mode: 0o755});
  executable("git", `case "$1" in status) printf '%s' "\${TEST_DIRTY:-}" ;; rev-parse) echo aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ;; esac`);
  executable("docker", `
    echo "$*" >> "$TEST_ROOT/docker.log"
    if [ "$1" = "tag" ]; then
      case "$*" in
        *release-candidate-test) touch "$TEST_ROOT/release-tagged" ;;
        *rollback-candidate-test) touch "$TEST_ROOT/rollback-tagged" ;;
      esac
    fi
    if [ "$1 \${2:-}" = "image inspect" ]; then
      case "$*" in
        *release-candidate-test*)
          if [ "\${TEST_EXISTING_RELEASE:-}" = release ] && [ ! -f "$TEST_ROOT/release-tagged" ]; then exit 0; fi
          if [ -f "$TEST_ROOT/release-tagged" ]; then echo sha256:candidate; exit 0; fi
          exit 1
          ;;
        *rollback-candidate-test*)
          if [ "\${TEST_EXISTING_RELEASE:-}" = rollback ] && [ ! -f "$TEST_ROOT/rollback-tagged" ]; then exit 0; fi
          if [ -f "$TEST_ROOT/rollback-tagged" ]; then echo sha256:approved; exit 0; fi
          exit 1
          ;;
        *org.opencontainers.image.revision*) echo "\${TEST_REVISION:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}" ;;
        *approved-baseline*) if [ "\${TEST_MISSING:-0}" = 1 ]; then exit 1; fi; echo sha256:approved ;;
        *) echo sha256:candidate ;;
      esac
    fi
    if [ "$1 \${2:-}" = "compose build" ] && [ "\${TEST_BUILD_FAIL:-0}" = 1 ]; then exit 1; fi
    if [ "$1 \${2:-}" = "compose up" ] && [ "\${TEST_FAIL:-0}" = 1 ] && [ ! -f "$TEST_ROOT/failed" ]; then
      touch "$TEST_ROOT/failed"
      exit 1
    fi`);
  executable("sg", "exit 85");
  executable("sudo", "exit 85");
  executable("curl", `
    echo "$*" >> "$TEST_ROOT/curl.log"
    case "$*" in
      *127.0.0.1:3001/healthz*) if [ "\${TEST_HEALTH_FAIL:-0}" = 1 ]; then exit 1; fi ;;
      *127.0.0.1:3001/health/*) if [ "\${TEST_PROXY_HEALTH_FAIL:-0}" = 1 ]; then exit 1; fi ;;
    esac
    echo '<title>UI Lab · Mis cuentas</title><script src="/assets/test.js"></script>'`);
  executable("node", `echo 'mocked smoke passed'`);
  const result = spawnSync("sh", [script, ...args], {encoding: "utf8", env: {...process.env, PATH: `${root}/bin:${process.env.PATH}`, TEST_ROOT: root, ...overrides}});
  let calls = "";
  try { calls = readFileSync(path.join(root, "docker.log"), "utf8"); } catch { /* argument rejection occurs before Docker */ }
  let curlCalls = "";
  try { curlCalls = readFileSync(path.join(root, "curl.log"), "utf8"); } catch { /* build rejection occurs before smoke checks */ }
  return {...result, calls, curlCalls};
}

describe.skipIf(process.platform === "win32")("React release safe rollback", () => {
  it("requires an explicit approved baseline and a clean source tree", () => {
    const missingArgument = runRelease({}, ["candidate-test"]);
    expect(missingArgument.status).toBe(2);
    expect(missingArgument.calls).toBe("");
    const dirty = runRelease({TEST_DIRTY: " M file"});
    expect(dirty.status).toBe(1);
    expect(dirty.calls).not.toContain("compose build");
    const missingImage = runRelease({TEST_MISSING: "1"});
    expect(missingImage.status).toBe(1);
    expect(missingImage.calls).not.toContain("compose build");
  });
  it("tags the explicit baseline and builds/verifies the source SHA", () => {
    const result = runRelease();
    expect(result.status, result.stderr).toBe(0);
    expect(result.calls).toContain("tag sha256:approved app-de-mis-cuentas-react-web:rollback-candidate-test");
    expect(result.calls).toContain("compose build --build-arg SOURCE_REVISION=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa react-web");
    expect(result.calls).toContain('org.opencontainers.image.revision');
    expect(result.stdout).toContain("baseline rollback: sha256:approved");
    expect(result.curlCalls).toContain("http://127.0.0.1:3001/health/");
    expect(result.curlCalls).not.toContain("/api/bootstrap/");
  });
  it("rejects an image with the wrong source revision before activation", () => {
    const result = runRelease({TEST_REVISION: "wrong"});
    expect(result.status).toBe(1);
    expect(result.calls.match(/compose up/g)).toHaveLength(1);
    expect(result.calls).toContain("tag app-de-mis-cuentas-react-web:rollback-candidate-test app-de-mis-cuentas-react-web:latest");
  });
  it("restores the approved baseline when activation fails", () => {
    const result = runRelease({TEST_FAIL: "1"});
    expect(result.status).toBe(1);
    expect(result.calls).toContain("tag app-de-mis-cuentas-react-web:rollback-candidate-test app-de-mis-cuentas-react-web:latest");
    expect(result.calls.match(/compose up/g)).toHaveLength(2);
  });
  it("restores the approved baseline when the candidate build fails", () => {
    const result = runRelease({TEST_BUILD_FAIL: "1"});
    expect(result.status).toBe(1);
    expect(result.calls).toContain("tag app-de-mis-cuentas-react-web:rollback-candidate-test app-de-mis-cuentas-react-web:latest");
    expect(result.calls.match(/compose up/g)).toHaveLength(1);
  });
  it("restores the baseline when post-activation health validation fails", () => {
    const result = runRelease({TEST_HEALTH_FAIL: "1"});
    expect(result.status).toBe(1);
    expect(result.calls.match(/compose up/g)).toHaveLength(2);
    expect(result.calls).toContain("tag app-de-mis-cuentas-react-web:rollback-candidate-test app-de-mis-cuentas-react-web:latest");
  });
  it("restores the baseline when the public Django health check through Nginx fails", () => {
    const result = runRelease({TEST_PROXY_HEALTH_FAIL: "1"});
    expect(result.status).toBe(1);
    expect(result.curlCalls).toContain("http://127.0.0.1:3001/health/");
    expect(result.calls.match(/compose up/g)).toHaveLength(2);
  });
  it.each(["release", "rollback"])("rejects reuse of an existing %s reference before mutating latest", (kind) => {
    const result = runRelease({TEST_EXISTING_RELEASE: kind});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no se puede reutilizar");
    expect(result.calls).not.toContain("tag ");
    expect(result.calls).not.toContain("compose build");
  });
});
