#!/bin/sh
set -eu

SHOW_HOSTS_CMD='SHOW HOSTS;'
ADD_HOSTS_CMD='ADD HOSTS "nebula-storaged":9779;'

until nebula-console -addr nebula-graphd -port 9669 -u root -p nebula -e "$SHOW_HOSTS_CMD" > /tmp/hosts.txt 2>&1; do
  sleep 2
done

if ! grep -q 'nebula-storaged' /tmp/hosts.txt; then
  nebula-console -addr nebula-graphd -port 9669 -u root -p nebula -e "$ADD_HOSTS_CMD"
fi

until nebula-console -addr nebula-graphd -port 9669 -u root -p nebula -e "$SHOW_HOSTS_CMD" > /tmp/hosts-ready.txt 2>&1 \
  && grep -q 'nebula-storaged' /tmp/hosts-ready.txt \
  && grep -q 'ONLINE' /tmp/hosts-ready.txt; do
  cat /tmp/hosts-ready.txt || true
  sleep 2
done

cat /tmp/hosts-ready.txt
