# Judge0 Runner

Edvols can use Judge0 as an external code runner for programming practice and programming assessments.

The frontend and main backend stay the same. The backend sends code and test cases to Judge0, then stores the result in MongoDB.

## Backend Environment

Set these in `backend/.env` when you want to use Judge0:

```env
CODE_RUNNER_PROVIDER=judge0
JUDGE0_BASE_URL=http://localhost:2358
JUDGE0_API_KEY=
JUDGE0_AUTH_HEADER=X-Auth-Token
JUDGE0_REQUEST_TIMEOUT_MS=30000
JUDGE0_REQUEST_RETRIES=2
JUDGE0_CONCURRENCY=2
JUDGE0_POLL_INTERVAL_MS=1000
JUDGE0_POLL_ATTEMPTS=30
```

Set `CODE_RUNNER_PROVIDER=local` only if you want to temporarily use the old child-process runner.

If your Judge0 instance uses different language IDs, override them with JSON:

```env
JUDGE0_LANGUAGE_IDS={"javascript":63,"typescript":74,"python":71,"java":62,"cpp":54,"c":50,"csharp":51,"go":60,"rust":73,"kotlin":78,"ruby":72,"swift":83,"php":68}
```

## Standalone Judge0 Service

This repo includes a portable Judge0 service folder at:

```text
../judge0-service
```

Use this folder for local testing or copy it to a VPS when you are ready to run Judge0 separately from the Edvols backend.

First-time setup:

```bash
cd ../judge0-service
chmod +x scripts/*.sh
./scripts/generate-secrets.sh
```

The setup script creates `judge0.conf`, `.env`, and prints a Judge0 API token. Put that token in the Edvols backend as `JUDGE0_API_KEY`.

Start Judge0:

```bash
sudo ./scripts/start.sh
```

Check Judge0:

```bash
./scripts/healthcheck.sh
curl -H "X-Auth-Token: YOUR_JUDGE0_TOKEN" http://localhost:2358/languages
```

If Edvols backend and Judge0 run on the same machine, keep the Judge0 service bound to localhost and use:

```env
JUDGE0_BASE_URL=http://localhost:2358
```

If Edvols backend and Judge0 run on different machines, expose port `2358` only to the Edvols backend IP and keep `AUTHN_TOKEN` enabled in `judge0.conf`.

## Local Judge0 Verification

After Judge0 starts, verify:

```bash
curl -H "X-Auth-Token: YOUR_JUDGE0_TOKEN" http://localhost:2358/about
curl -H "X-Auth-Token: YOUR_JUDGE0_TOKEN" http://localhost:2358/languages
```

Then run the Edvols backend:

```bash
cd backend
npm run dev
```

Check that Edvols can see Judge0:

```bash
curl http://localhost:8000/api/health
```

The response should include:

```json
{
  "code_runner": {
    "provider": "judge0",
    "healthy": true
  }
}
```

Run the deeper execution probe if `/about` works but submissions fail:

```bash
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" "http://localhost:8000/api/health/runner?deep=1"
```

If this returns `execution_healthy: false` with an error like `No such file or directory @ rb_sysopen - /box/script.py`, the Judge0 API is reachable but the Judge0 sandbox cannot execute code.

On Linux hosts, this is commonly caused by Judge0/isolate requiring legacy cgroup v1 support. Add these kernel parameters:

```text
SYSTEMD_CGROUP_ENABLE_LEGACY_FORCE=1 systemd.unified_cgroup_hierarchy=0
```

Then update GRUB and reboot:

```bash
sudo sed -i 's/GRUB_CMDLINE_LINUX="/GRUB_CMDLINE_LINUX="SYSTEMD_CGROUP_ENABLE_LEGACY_FORCE=1 systemd.unified_cgroup_hierarchy=0 /' /etc/default/grub
sudo update-grub
sudo reboot
```

After reboot, restart Judge0:

```bash
cd ~/judge0-service
sudo ./scripts/stop.sh
sudo ./scripts/start.sh
```

## VPS Shape

For production, keep Judge0 separate from the Edvols API:

```text
Edvols frontend -> Edvols backend -> Judge0 VPS
```

Protect the Judge0 API with a firewall, reverse proxy auth, or Judge0 auth token. Do not call Judge0 directly from the browser because that exposes runner access and hidden test-case behavior.
