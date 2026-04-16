# Rollback Plan

1. Keep immutable backend images tagged by release SHA.
2. Keep previous stable image in deployment target and one-click rollback command.
3. Version SQL migrations in VCS and include reversible down scripts.
4. Before mainnet deploy, test restore from backup to staging and replay API health checks.

# Security Gate

- [ ] Anchor state transition and lamport accounting tests green
- [ ] Backend auth/session/rate-limit tests green
- [ ] Dependency audit has no critical advisories
- [ ] Production CORS and firewall rules validated (80/443 only)
- [ ] Environment secrets injected from platform secret stores only
