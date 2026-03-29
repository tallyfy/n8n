# n8n - Tallyfy Custom Nodes

> **NEVER use auto memory** (`~/.claude/projects/*/memory/`) — store all knowledge in CLAUDE.md files.

## Overview

Custom n8n community node package providing 60+ Tallyfy API tools for workflow automation.

## Production Deployment

- **Droplet**: answers-n8n (64.227.104.197), ID 405593214
- **Path**: /home/n8n/
- **Container**: n8n (port 5678, image: n8n-n8n)
- **Database**: PostgreSQL 17 on same droplet (database: n8n, 10 MB)
- **Docker network**: n8n
- **Tunnel**: n8n.tallyfy.com via mcp&answers tunnel (2a507cba-31a4-4732-adf9-7a137b9b9b4a)
- **CI/CD**: None — deployed manually
- **Backups**: DO usage-based weekly backups enabled (2026-03-29)

**Full DO infrastructure docs**: See `systems/docs/DigitalOcean_Infrastructure.md`

## Known Issues

- **Boot-order dependency**: After droplet reboot, PostgreSQL must listen on Docker bridge IPs (`172.17.0.1`) before n8n can start. PG `listen_addresses` includes Docker bridges but they don't exist at PG boot time. **Fix**: Restart PG after boot (`systemctl restart postgresql@17-main`) then restart n8n (`docker restart n8n`).
- No automated deployment pipeline
- Workflows/credentials backed up via DO droplet-level weekly backups (enabled 2026-03-29)
