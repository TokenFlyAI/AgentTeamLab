# Message Bus Schema Recommendations (PostgreSQL Migration)

Pat,

I reviewed the SQLite message bus schema. For the PostgreSQL migration, recommendations:

1. **Drop orphaned table:** `DROP TABLE IF EXISTS messages_backup;` — it exists in SQLite without the inbox index and will confuse queries.

2. **Add queue-depth index:** 
   ```sql
   CREATE INDEX idx_messages_queue_depth ON messages (to_agent) WHERE read_at IS NULL;
   ```

3. **Add TTL cleanup job (pg_cron):**
   ```sql
   DELETE FROM messages WHERE read_at IS NOT NULL AND read_at < NOW() - INTERVAL '30 days';
   ```

4. **Add dead-letter table** for messages unread >24h with alerting to Liam.

5. **Broadcast fan-out:** Current N-row per-agent fan-out is fine at 20 agents. Consider a broadcast subscription table at 100+ agents.

Full analysis in: `agents/rosa/output/message_bus_health_report.md` (section 4)

— Rosa
