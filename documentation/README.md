# Documentation

Assessment documentation for the Cyber Range lab *"Cookies Reuse & MFA Bypass"*.
Repository: <https://github.com/iduy01/naulidata-cyberrange>

| File | What it is |
|------|------------|
| [`RUNBOOK.md`](RUNBOOK.md) · [`.pdf`](RUNBOOK.pdf) · [`.docx`](RUNBOOK.docx) | Step-by-step operating runbook (Bahasa Indonesia): prerequisites, deploy on Proxmox, demo order (Red → re-seed → Blue), teardown, troubleshooting. |
| [`WRITTEN-EXPLANATION.md`](WRITTEN-EXPLANATION.md) · [`Practical-Assessment-Written-Explanation.pdf`](Practical-Assessment-Written-Explanation.pdf) · [`.docx`](Practical-Assessment-Written-Explanation.docx) | Written explanation of the design: how every requirement in the brief is implemented, the full Red/Blue attack paths and the complete `SCENARIO75{...}` answer key (38 flags, 7 tables). Section 3 (Red Team attack path) is pinned to a single page. |
| [`VERIFICATION.md`](VERIFICATION.md) | Verification log from a live run: `bash scripts/verify.sh` → **20 passed, 0 failed**, plus the manual Red Team (cookie theft → replay → flag) and Blue Team (log forensics → base64 → CRITICAL anomaly) evidence. |

## Where the rest lives

| Subject | Location |
|---------|----------|
| Deployment instructions (brief) | [`README.md`](../README.md#2-deployment-proxmox-environment) §2 |
| Deployment instructions (full, incl. cloud-init / VM template export) | [`PROXMOX-DEPLOY.md`](../PROXMOX-DEPLOY.md) |
| Red & Blue walkthroughs (full, command level) | [`walkthrough/`](../walkthrough/) |
| Answer key | [`ANSWER-KEY.md`](../ANSWER-KEY.md) |
| Map of repo → submission requirements | [`CODE-REPOSITORY.md`](../CODE-REPOSITORY.md) |

## Reproduce the verification

```bash
sudo bash scripts/provision.sh                 # deploy + seed telemetry
bash scripts/verify.sh                         # -> 20 passed, 0 failed
```

The PDFs are rendered from the markdown sources in this folder; edit the `.md`
when something changes and re-export.
