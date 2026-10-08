# Blue Team Walkthrough — Log Forensics, Threat Hunting & Incident Response

Access the analyst workstation and the shared logs:

```bash
ssh analyst@<VM-IP> -p 2275        # password: blue_team_rocks
ls -la /opt/admin/logs
# access.log   error.log
```
→ `SCENARIO75{/opt/admin/logs}`

---

## Phase 1 — Log Forensics

**Attacker footprint.** One IP keeps appearing with a non-browser-looking UA and the
attack method sequence:

```bash
grep '10.10.14.50' /opt/admin/logs/access.log
# 10.10.14.50 - - [DD/Mon/YYYY:18:49:30 +0700] "GET /robots.txt HTTP/1.1" 200 ... "Mozilla/5.0 ..."
# 10.10.14.50 - - [DD/Mon/YYYY:18:50:15 +0700] "POST /api/feedback HTTP/1.1" 403 0 ... "Mozilla/5.0 ..."
```
→ `SCENARIO75{10.10.14.50}`, `SCENARIO75{Mozilla/5.0}`

**Dashboard access (the win).** A successful hit against the restricted area. Scope the
query to the attacker so the admin bot's own dashboard refreshes (every ~20 s) don't
drown the result:

```bash
grep '10.10.14.50' /opt/admin/logs/access.log | grep '/dashboard' | grep ' 200 '
# ... [DD/Mon/YYYY:18:51:55 +0700] "GET /dashboard HTTP/1.1" 200 9120 ... xff=UEhBTlRPTUdS...
```
→ `SCENARIO75{200}`, `SCENARIO75{18:51:55}`

> **Log hygiene.** The app appends live traffic to the same file. If the Red demo has
> already run, re-seed the log before this walkthrough so the output stays clean:
> `docker compose exec -T app python3 /usr/src/app/scripts/inject_logs.py --dir /opt/admin/logs --clear`
> The attacker-IP grep above is clean either way.

**Exfiltration header.** The `X-Forwarded-For` header on that request carries a
Base64 blob:

```bash
grep -o 'xff=[A-Za-z0-9+/=]*' /opt/admin/logs/access.log | sort -u
# xff=UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0
```
→ `SCENARIO75{UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0}`

---

## Phase 2 — Threat Hunting

**Baseline.** Legitimate administrators come from a different network:

```bash
awk '{print $1}' /opt/admin/logs/access.log | sort | uniq -c | sort -rn
#  4 192.168.1.100     ← normal admin traffic (baseline)
#  6 10.10.14.50       ← attacker
```
→ `SCENARIO75{192.168.1.100}`

**Subnet mapping.** The attacker IP belongs to `10.10.14.0/24`.

```bash
python3 - <<'PY'
import ipaddress
print(ipaddress.ip_network('10.10.14.50/24', strict=False))
PY
```
→ `SCENARIO75{10.10.14.0/24}`

**First WAF block.** The error log records the earliest blocked payload:

```bash
grep -i 'WAF' /opt/admin/logs/error.log | head
# 2026-..-..T18:50:15+07:00 [WARN] WAF blocked payload containing forbidden token "<script>" from 10.10.14.50
```
→ `SCENARIO75{/opt/admin/logs/error.log}`, `SCENARIO75{<script>}`, `SCENARIO75{18:50:15}`

**Did the attacker reach the MFA endpoint?** Cross-check every access by the
attacker against `/api/verify-mfa`:

```bash
grep '10.10.14.50' /opt/admin/logs/access.log | grep '/api/verify-mfa'
# (no output)
```
The attacker **never** hit `/api/verify-mfa` — proof that the replay bypassed MFA.
→ `SCENARIO75{No}`

---

## Phase 3 — Incident Response

**Encoding analysis.** The suspicious value is Base64 (44-char class, `+/=`-safe
charset). Decode it:

```bash
echo 'UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0=' | base64 -d
# PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}
```
→ `SCENARIO75{Base64}`, `SCENARIO75{44}`

**Severity markers.** Cookie-reuse events are flagged `CRITICAL`:

```bash
grep CRITICAL /opt/admin/logs/error.log
```
→ `SCENARIO75{CRITICAL}`

**Anomaly timestamp.** The decisive security warning is at `18:53:10`:

```bash
grep 'Authentication bypass anomaly' /opt/admin/logs/error.log
# 2026-..-..T18:53:10+07:00 [CRITICAL] Authentication bypass anomaly: admin session cookie reused without MFA ...
```
→ `SCENARIO75{18:53:10}`, `SCENARIO75{Authentication bypass anomaly}`

**Final flag.** The decoded Base64 string is the Blue Team victory flag:

→ **`SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}`**

---

## Incident-response summary (fill into the report)

| Field | Value |
|-------|-------|
| Detection source | `error.log` CRITICAL entry @ `18:53:10` |
| Attack window | `18:49:30` → `18:54:12` |
| Attacker | `10.10.14.50` (`10.10.14.0/24`), UA `Mozilla/5.0` |
| Initial vector | stored XSS via `POST /api/feedback` (WAF bypass: `<svg onload>`) |
| Impact | `adm_sess` bearer token stolen & replayed → MFA (`/api/verify-mfa`) bypassed |
| Evidence | `access.log` 403@`18:50:15`, 200 `/dashboard`@`18:51:55`, XFF Base64, `error.log` "Authentication bypass anomaly" |
| Root cause | session tokens issued without MFA binding, never expire, not client-bound, and `HttpOnly=False` |
| Containment | invalidate `adm_sess_*` tokens, force re-auth, block `10.10.14.50`, patch WAF, set `HttpOnly`+`Secure` |
