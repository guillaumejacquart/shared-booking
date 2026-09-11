#!/bin/sh
set -e
node src/db/migrate.ts
exec node server.js
