#!/usr/bin/env bash
#
# proxmox-create-vm.sh — create the Cyber Range VM on a Proxmox VE host.
#
# RUN THIS ON THE PROXMOX NODE (as root), not inside a guest:
#     scp scripts/proxmox-create-vm.sh scripts/cloud-init-user-data.yaml root@<pve>:/root/
#     ssh root@<pve> 'bash /root/proxmox-create-vm.sh'
#
# It boots a Debian 12 cloud image whose cloud-init clones this repository and
# runs scripts/provision.sh on first boot — no console login required. When the
# lab is up the guest writes /var/log/cyberrange-ready.
#
# Prerequisite: enable "Snippets" content on the target storage once
#   Datacenter > Storage > local > Edit > Content > tick "Snippets"
#
# Overridable via environment:
#   VMID=901 CORES=4 MEM=8192 DISK=30G BRIDGE=vmbr1 STORAGE=local-lvm bash proxmox-create-vm.sh
#
set -euo pipefail

VMID="${VMID:-900}"
NAME="${NAME:-cyberrange}"
CORES="${CORES:-2}"
MEM="${MEM:-4096}"
DISK="${DISK:-20G}"
BRIDGE="${BRIDGE:-vmbr0}"
STORAGE="${STORAGE:-local-lvm}"
SNIPPET_STORAGE="${SNIPPET_STORAGE:-local}"
CLOUD_IMG_URL="${CLOUD_IMG_URL:-https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2}"
IMG_DIR="${IMG_DIR:-/var/lib/vz/template/iso}"
IMG_FILE="${IMG_DIR}/debian-12-genericcloud-amd64.qcow2"
SNIPPET_DIR="${SNIPPET_DIR:-/var/lib/vz/snippets}"
SNIPPET_NAME="cyberrange-user-data.yaml"
VM_USER="${VM_USER:-lab}"
VM_PASS="${VM_PASS:-cyberrange}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USERDATA="${HERE}/cloud-init-user-data.yaml"

log() { printf '\033[1;34m[proxmox]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

# --- preflight ---------------------------------------------------------------
[[ "${EUID}" -eq 0 ]] || die "run as root on the Proxmox host (sudo bash $0)"
command -v qm >/dev/null 2>&1 || die "'qm' not found — this does not look like a Proxmox VE node"
command -v qemu-img >/dev/null 2>&1 || die "'qemu-img' not found"
[[ -f "${USERDATA}" ]] || die "cloud-init file not found next to this script: ${USERDATA}"
if qm status "${VMID}" >/dev/null 2>&1; then
  die "VMID ${VMID} already exists — remove it first with: qm destroy ${VMID}"
fi

# --- 1. cloud image ----------------------------------------------------------
log "preparing cloud image"
mkdir -p "${IMG_DIR}"
if [[ -s "${IMG_FILE}" ]]; then
  log "using cached image ${IMG_FILE}"
else
  log "downloading $(basename "${CLOUD_IMG_URL}")"
  curl -fL --retry 3 --retry-delay 2 -o "${IMG_FILE}" "${CLOUD_IMG_URL}"
fi

# --- 2. cloud-init snippet ---------------------------------------------------
log "installing cloud-init user-data -> ${SNIPPET_DIR}/${SNIPPET_NAME}"
mkdir -p "${SNIPPET_DIR}"
install -m 0644 "${USERDATA}" "${SNIPPET_DIR}/${SNIPPET_NAME}"

# --- 3. create the VM --------------------------------------------------------
log "creating VM ${VMID} (${NAME}: ${CORES} vCPU / ${MEM} MB / ${DISK})"
qm create "${VMID}" \
  --name "${NAME}" \
  --memory "${MEM}" \
  --cores "${CORES}" \
  --cpu host \
  --ostype l26 \
  --scsihw virtio-scsi-single \
  --net0 "virtio,bridge=${BRIDGE}" \
  --agent enabled=1 \
  --serial0 socket \
  --vga serial0

# --- 4. disk -----------------------------------------------------------------
log "importing the cloud image as the system disk"
qm importdisk "${VMID}" "${IMG_FILE}" "${STORAGE}" >/dev/null

DISK_REF="$(qm config "${VMID}" | awk -F': ' '/^unused[0-9]+:/{print $2; exit}')"
[[ -n "${DISK_REF}" ]] || die "qm importdisk produced no disk (check storage '${STORAGE}')"
log "disk imported as ${DISK_REF}"
qm set "${VMID}" --scsi0 "${DISK_REF}" --boot order=scsi0
qm resize "${VMID}" scsi0 "${DISK}"

# --- 5. cloud-init wiring ----------------------------------------------------
log "attaching the cloud-init drive"
qm set "${VMID}" --ide2 "${STORAGE}:cloudinit"
qm set "${VMID}" --ipconfig0 ip=dhcp
qm set "${VMID}" --ciuser "${VM_USER}" --cipassword "${VM_PASS}"
qm set "${VMID}" --cicustom "user=${SNIPPET_STORAGE}:snippets/${SNIPPET_NAME}"
qm set "${VMID}" --tags cyberrange,assessment

# --- 6. boot -----------------------------------------------------------------
log "starting VM ${VMID}"
qm start "${VMID}"

cat <<EOF

============================================================
  VM ${VMID} (${NAME}) is booting
------------------------------------------------------------
  On first boot cloud-init will:
    1. install git / curl / ca-certificates
    2. clone https://github.com/iduy01/naulidata-cyberrange.git -> /opt/naulidata-cyberrange
    3. run scripts/provision.sh  (Docker + /opt/admin/logs + compose up + seed logs)
    4. touch /var/log/cyberrange-ready

  Progress (from the Proxmox host):
      qm terminal ${VMID}
      #   tail -f /var/log/cloud-init-output.log
      #   tail -f /var/log/cyberrange-provision.log

  Find the IP:
      qm guest cmd ${VMID} network-get-interfaces     # needs the guest agent
      # or check your DHCP leases / router

  Then, from anywhere on the same network:
      curl -i http://<VM-IP>:3075/
      ssh ${VM_USER}@<VM-IP>                        # pw: ${VM_PASS}
      ssh analyst@<VM-IP> -p 2275                   # pw: blue_team_rocks

  Tear down:
      qm stop ${VMID} && qm destroy ${VMID}
============================================================
EOF
