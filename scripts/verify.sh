#!/bin/sh
# Kept for old habits: the checks now live in scripts/check.sh.
exec sh "$(dirname "$0")/check.sh" "$@"
