# Proxmox Deployment Guide

> Requirement: *"The final deliverable must be deployable as a Virtual Machine on a
> Proxmox hypervisor."*

This repository satisfies that in three complementary ways — pick whichever the
reviewer expects. Path A is the intended one; Path B and C exist so the lab can
also be handed over as a ready-to-boot VM.

| Path | Deliverable | Effort for the reviewer |
|------|-------------|-------------------------|
| **A** | Repo + `scripts/provision.sh` deployed inside a fresh Proxmox VM | ~5 min, 6 steps |
| **B** | Same, fully automated via cloud-init (no login needed) | 1 command |
| **C** | Prebuilt VM image / template imported into Proxmox | import + boot |

Everything below assumes a **Proxmox VE 8.x** node.

---

## Path A — fresh VM + provisioning script (recommended)

### 1. Create the VM (web GUI)

Proxmox web UI → `https://<pve-ip>:8006` → **Create VM**:

| Field | Value |
|-------|-------|
| Name | `cyberrange` |
| ISO | Debian 12 or Ubuntu 24.04 netinst |
| Disk | 20 GB (SCSI, `local-lvm`) |
| CPU | 2 cores (`host` type) |
| Memory | 4096 MB |
| Network | Bridge `vmbr0`, model `VirtIO` |

Equivalent CLI (run as root on the Proxmox node):

```bash
qm create 900 --name cyberrange --memory 4096 --cores 2 --net0 virtio,bridge=vmbr0
```

### 2. Install the OS, then deploy

Inside the VM:

```bash
sudo apt-get update && sudo apt-get install -y git
git clone https://github.com/iduy01/naulidata-cyberrange.git
cd naulidata-cyberrange
sudo bash scripts/provision.sh      # Docker + /opt/admin/logs + DNS + compose up + seed logs
bash scripts/verify.sh              # expect: 20 passed, 0 failed
```

`provision.sh` is idempotent and self-contained: it installs Docker Engine and the
compose plugin if missing, creates `/opt/admin/logs`, adds the internal DNS entry,
builds and starts the three services, then seeds the mock telemetry.

### 3. Reach it

```
Web (vulnerable app) : http://<VM-IP>:3075
Blue Team SSH        : ssh analyst@<VM-IP> -p 2275       (pw blue_team_rocks)
Logs                 : /opt/admin/logs/access.log  /opt/admin/logs/error.log
```

---

## Path B — fully automated via cloud-init

`scripts/proxmox-create-vm.sh` (run as root **on the Proxmox host**) creates the VM,
attaches a cloud-init drive and lets the guest deploy the lab by itself on first
boot — no console login, no manual steps.

```bash
# enable snippets on the 'local' storage once:
#   Datacenter > Storage > local > Edit > Content > tick "Snippets"
scp scripts/cloud-init-user-data.yaml root@<pve-ip>:/root/
scp scripts/proxmox-create-vm.sh     root@<pve-ip>:/root/
ssh root@<pve-ip> 'bash /root/proxmox-create-vm.sh'
```

The VM boots a Debian 12 cloud image, clones this repo to
`/opt/naulidata-cyberrange`, runs `provision.sh`, and writes
`/var/log/cyberrange-ready` when the range is up. Default VM login: `lab` / `cyberrange`.

Useful overrides:

```bash
VMID=901 CORES=4 MEM=8192 DISK=30G BRIDGE=vmbr1 bash proxmox-create-vm.sh
```

---

## Path C — hand over the VM itself (image / template)

If the reviewer expects an importable artefact rather than a repo:

**C1 — export a template from a working VM** (do this after Path A/B on the node):

```bash
qm shutdown 900
qm template 900                     # convert the VM into a template
# or back it up as a restorable archive:
vzdump 900 --mode stop --compress zstd --dumpdir /var/lib/vz/dump
# result: /var/lib/vz/dump/vzdump-qemu-900-*.vma.zst  -> restore with: qmrestore <file> 900
```

**C2 — ship the disk as a qcow2** (import on any Proxmox node):

```bash
# on the source host
qm shutdown 900 && qm rescan
qemu-img convert -O qcow2 /dev/pve/vm-900-disk-0 ./cyberrange.qcow2

# on the target Proxmox node
qm create 900 --name cyberrange --memory 4096 --cores 2 --net0 virtio,bridge=vmbr0
qm importdisk 900 cyberrange.qcow2 local-lvm
qm set 900 --scsi0 local-lvm:vm-900-disk-0 --boot order=scsi0
qm start 900
```

`.vma.zst` / `qmrestore` is the most faithful hand-over for Proxmox; `.qcow2`
also works on other hypervisors.

---

## Proxmox-specific notes

- **Bridged networking, not NAT-only.** The Red Team phase needs the admin bot
  container to reach the attacker's listener for the cookie exfiltration. On a
  bridged VM (`vmbr0`) the attacker sits on the same LAN and that works out of the
  box. On a NAT-only setup, forward the listener port explicitly.
- **Never expose `3075` / `2275` to the internet.** This is an intentionally
  vulnerable application. Keep it inside the lab network / VM firewall.
- **Sizing.** 2 vCPU, 4 GB RAM, 20 GB disk is enough; allow ~8 GB for the Docker
  images (`node:20-slim` + Chromium is the big one).
- **State.** `adm_sess` tokens and the feedback queue are in-memory and reset on
  container restart; the seeded telemetry in `/opt/admin/logs` persists (it lives
  in the bind-mounted `logs/` directory).
- **Snapshots.** Take a Proxmox snapshot right after `verify.sh` passes — you can
  then roll back between demo runs instead of rebuilding.
