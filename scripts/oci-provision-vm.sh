#!/usr/bin/env bash
# Retry-until-success provisioner for VM.Standard.A1.Flex on OCI.
# Tries all 3 availability domains in us-chicago-1, rotating until capacity is available.
#
# Prerequisites:
#   1. Install OCI CLI:  brew install oci-cli
#   2. Configure:        oci setup config  (follow prompts — needs tenancy OCID, user OCID, API key)
#   3. Set variables below (COMPARTMENT_OCID, SUBNET_OCID, SSH_KEY_PATH)
#
# Usage:
#   chmod +x scripts/oci-provision-vm.sh
#   ./scripts/oci-provision-vm.sh
#
# The script polls every 60 seconds until the instance is RUNNING.
# Kill with Ctrl-C; the instance request is not left dangling (OCI handles cleanup on failed provisions).

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
COMPARTMENT_OCID=""        # paste from OCI console: Identity → Compartments → root OCID
SUBNET_OCID=""             # paste from OCI console: Networking → VCNs → your VCN → Subnets
SSH_KEY_PATH="$HOME/.ssh/id_ed25519.pub"  # path to your public SSH key
REGION="us-chicago-1"
SHAPE="VM.Standard.A1.Flex"
OCPUS=2
MEMORY_GB=12
IMAGE_DISPLAY_NAME="Canonical-Ubuntu-24.04"
INSTANCE_NAME="fitlocal"
RETRY_INTERVAL=60  # seconds between attempts
# ─────────────────────────────────────────────────────────────────────────────

if [[ -z "$COMPARTMENT_OCID" || -z "$SUBNET_OCID" ]]; then
  echo "ERROR: Set COMPARTMENT_OCID and SUBNET_OCID in this script before running."
  exit 1
fi

if ! command -v oci &>/dev/null; then
  echo "ERROR: OCI CLI not found. Install with: brew install oci-cli"
  echo "Then configure with: oci setup config"
  exit 1
fi

# Look up the latest Ubuntu 24.04 ARM image OCID
echo "Looking up Ubuntu 24.04 image..."
IMAGE_OCID=$(oci compute image list \
  --compartment-id "$COMPARTMENT_OCID" \
  --operating-system "Canonical Ubuntu" \
  --operating-system-version "24.04" \
  --shape "$SHAPE" \
  --sort-by TIMECREATED \
  --sort-order DESC \
  --query 'data[0].id' \
  --raw-output \
  --region "$REGION")

if [[ -z "$IMAGE_OCID" || "$IMAGE_OCID" == "null" ]]; then
  echo "ERROR: Could not find Ubuntu 24.04 image for $SHAPE. Check OCI console."
  exit 1
fi
echo "Image OCID: $IMAGE_OCID"

SSH_KEY=$(cat "$SSH_KEY_PATH")
ADS=("AD-1" "AD-2" "AD-3")
ATTEMPT=0

while true; do
  for AD in "${ADS[@]}"; do
    ATTEMPT=$((ATTEMPT + 1))
    echo "[$(date '+%H:%M:%S')] Attempt $ATTEMPT — trying $AD..."

    RESULT=$(oci compute instance launch \
      --compartment-id "$COMPARTMENT_OCID" \
      --availability-domain "$AD" \
      --shape "$SHAPE" \
      --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEMORY_GB}" \
      --image-id "$IMAGE_OCID" \
      --subnet-id "$SUBNET_OCID" \
      --assign-public-ip true \
      --display-name "$INSTANCE_NAME" \
      --ssh-authorized-keys-file "$SSH_KEY_PATH" \
      --region "$REGION" \
      --wait-for-state RUNNING \
      --max-wait-seconds 300 \
      2>&1 || true)

    if echo "$RESULT" | grep -q '"lifecycle-state": "RUNNING"'; then
      echo ""
      echo "✅ Instance is RUNNING in $AD!"
      INSTANCE_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null || echo "see OCI console")
      PUBLIC_IP=$(oci compute instance list-vnics \
        --instance-id "$INSTANCE_ID" \
        --region "$REGION" \
        --query 'data[0]."public-ip"' \
        --raw-output 2>/dev/null || echo "see OCI console")
      echo "Instance OCID: $INSTANCE_ID"
      echo "Public IP:     $PUBLIC_IP"
      echo ""
      echo "SSH: ssh ubuntu@$PUBLIC_IP"
      exit 0
    elif echo "$RESULT" | grep -qi "out of host capacity\|LimitExceeded"; then
      echo "  ↳ Out of capacity in $AD, trying next..."
    else
      echo "  ↳ Unexpected response, trying next... (check output below)"
      echo "$RESULT" | head -5
    fi
  done

  echo "[$(date '+%H:%M:%S')] All 3 ADs at capacity. Waiting ${RETRY_INTERVAL}s before next round..."
  sleep "$RETRY_INTERVAL"
done
