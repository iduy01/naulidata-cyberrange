#!/usr/bin/env python3
"""
inject_logs.py — seed a realistic Red-Team attack story into /opt/admin/logs.

Run automatically by provision.sh at deploy time. It writes:
  <LOG_DIR>/access.log  (Nginx-style combined format, with X-Forwarded-For)
  <LOG_DIR>/error.log   (application / WAF / security warnings)

The generated timeline contains every artefact the Blue Team is expected to
find during log forensics, threat hunting and incident response.

Usage:
  python3 inject_logs.py [--dir /opt/admin/logs] [--append] [--clear]

Answers embedded in the log (SCENARIO75{...} answer key):
  /opt/admin/logs, 10.10.14.50, Mozilla/5.0, 200, 18:51:55,
  UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0, 192.168.1.100,
  10.10.14.0/24, /opt/admin/logs/error.log, <script>, 18:50:15, No,
  Base64, 44, CRITICAL, 18:53:10, Authentication bypass anomaly
"""
import argparse
import os
from datetime import datetime

# The exact Base64 string the assessment requires in the X-Forwarded-For header.
XFF_B64 = "UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0"

ATTACKER_IP = "10.10.14.50"          # 10.10.14.0/24
BASELINE_IP = "192.168.1.100"
ATTACKER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
BASELINE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Microsoft Edge/126.0"

DAY = datetime.now().strftime("%d/%b/%Y")

# (time, ip, method, path, status, bytes, ua, xff)
ACCESS_EVENTS = [
    ("18:47:02", BASELINE_IP, "GET",  "/",              200, 4831, BASELINE_UA, BASELINE_IP),
    ("18:47:55", BASELINE_IP, "GET",  "/dashboard",     200, 9021, BASELINE_UA, BASELINE_IP),
    ("18:48:11", BASELINE_IP, "GET",  "/api/verify-mfa",200, 1204, BASELINE_UA, BASELINE_IP),
    ("18:49:30", ATTACKER_IP, "GET",  "/robots.txt",    200,  118, ATTACKER_UA, ATTACKER_IP),
    ("18:49:58", ATTACKER_IP, "GET",  "/",              200, 4831, ATTACKER_UA, ATTACKER_IP),
    ("18:50:15", ATTACKER_IP, "POST", "/api/feedback",  403,    0, ATTACKER_UA, ATTACKER_IP),
    ("18:50:48", ATTACKER_IP, "POST", "/api/feedback",  200,  401, ATTACKER_UA, ATTACKER_IP),
    ("18:51:30", BASELINE_IP, "GET",  "/dashboard",     200, 9021, BASELINE_UA, BASELINE_IP),
    ("18:51:55", ATTACKER_IP, "GET",  "/dashboard",     200, 9120, ATTACKER_UA, XFF_B64),
    ("18:52:40", ATTACKER_IP, "GET",  "/dashboard",     200, 9160, ATTACKER_UA, XFF_B64),
    ("18:54:12", BASELINE_IP, "GET",  "/",              200, 4831, BASELINE_UA, BASELINE_IP),
]

# (time, level, message)
ERROR_EVENTS = [
    ("18:50:15", "WARN",
     f'WAF blocked payload containing forbidden token "<script>" from {ATTACKER_IP} (uri=/api/feedback)'),
    ("18:50:15", "CRITICAL",
     f'WAF ALERT: first <script> tag blocked for {ATTACKER_IP}'),
    ("18:50:48", "INFO",
     f'feedback stored, author=anonymous src={ATTACKER_IP} (payload length 96)'),
    ("18:53:10", "CRITICAL",
     f'Authentication bypass anomaly: admin session cookie reused without MFA. '
     f'user=admin src={ATTACKER_IP} path=/dashboard verification=/api/verify-mfa(skipped) '
     f'X-Forwarded-For={XFF_B64}'),
    ("18:53:10", "CRITICAL",
     f'cookie reuse event flagged CRITICAL (bearer token not bound to client)'),
]


def nginx_line(t, ip, method, path, status, size, ua, xff):
    return (
        f'{ip} - - [{DAY}:{t} +0700] "{method} {path} HTTP/1.1" '
        f'{status} {size} "-" "{ua}" xff={xff}'
    )


def app_line(t, level, msg):
    d = datetime.now().strftime("%Y-%m-%d")
    return f"{d}T{t}+07:00 [{level}] {msg}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.environ.get("LOG_DIR", "/opt/admin/logs"))
    ap.add_argument("--append", action="store_true", help="append instead of overwrite")
    ap.add_argument("--clear", action="store_true", help="truncate both logs")
    args = ap.parse_args()

    os.makedirs(args.dir, exist_ok=True)
    access = os.path.join(args.dir, "access.log")
    error = os.path.join(args.dir, "error.log")
    mode = "a" if (args.append and not args.clear) else "w"

    with open(access, mode) as fa, open(error, mode) as fe:
        fa.write(f"# --- seeded scenario: Cookies Reuse & MFA Bypass ---\n")
        for ev in ACCESS_EVENTS:
            fa.write(nginx_line(*ev) + "\n")
        fe.write(f"# --- seeded scenario: Cookies Reuse & MFA Bypass ---\n")
        for ev in ERROR_EVENTS:
            fe.write(app_line(*ev) + "\n")

    print(f"[inject_logs] wrote {len(ACCESS_EVENTS)} access events -> {access}")
    print(f"[inject_logs] wrote {len(ERROR_EVENTS)} error events  -> {error}")


if __name__ == "__main__":
    main()
