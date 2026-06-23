<script>
  export let data;
</script>

<svelte:head>
  <title>PostFoundry Runtime</title>
</svelte:head>

<main class="shell">
  <section class="status">
    <div>
      <h1>PostFoundry Runtime</h1>
      <p>Local storage baseline</p>
    </div>
    <span class="badge">{data.health.status}</span>
  </section>

  <section class="grid">
    <div class="panel">
      <h2>Database</h2>
      <dl>
        <div>
          <dt>Migrations</dt>
          <dd>{data.health.database.applied_migrations.length}</dd>
        </div>
        <div>
          <dt>Tables</dt>
          <dd>{data.health.database.tables.length}</dd>
        </div>
      </dl>
    </div>

    <div class="panel">
      <h2>Runtime</h2>
      <dl>
        <div>
          <dt>Accounts</dt>
          <dd>{data.health.counts.accounts}</dd>
        </div>
        <div>
          <dt>Jobs</dt>
          <dd>{data.health.counts.jobs}</dd>
        </div>
        <div>
          <dt>API audits</dt>
          <dd>{data.health.counts.api_call_audit}</dd>
        </div>
      </dl>
    </div>

    <div class="panel">
      <h2>Audit</h2>
      <dl>
        <div>
          <dt>Events</dt>
          <dd>{data.health.counts.audit_events}</dd>
        </div>
        <div>
          <dt>AI runs</dt>
          <dd>{data.health.counts.ai_runs}</dd>
        </div>
        <div>
          <dt>Decisions</dt>
          <dd>{data.health.counts.ai_decisions}</dd>
        </div>
        <div>
          <dt>Actions</dt>
          <dd>{data.health.counts.ai_actions}</dd>
        </div>
        <div>
          <dt>Evidence</dt>
          <dd>{data.health.counts.evidence_refs}</dd>
        </div>
        <div>
          <dt>Reviews</dt>
          <dd>{data.health.counts.human_reviews}</dd>
        </div>
      </dl>
    </div>
  </section>

  <section class="panel">
    <h2>Accounts</h2>
    {#if data.accounts.length === 0}
      <p class="empty">No accounts persisted yet.</p>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Key</th>
            <th>UUID</th>
            <th>Language</th>
            <th>Version</th>
          </tr>
        </thead>
        <tbody>
          {#each data.accounts as account}
            <tr>
              <td>{account.account_key}</td>
              <td>{account.account_uuid}</td>
              <td>{account.language}</td>
              <td>{account.config_version}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </section>
</main>

<style>
  :global(body) {
    margin: 0;
    background: #f5f7f8;
    color: #172026;
    font-family:
      Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  .shell {
    width: min(1120px, calc(100vw - 32px));
    margin: 0 auto;
    padding: 28px 0 40px;
  }

  .status {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
  }

  h1,
  h2,
  p {
    margin: 0;
  }

  h1 {
    font-size: 28px;
    font-weight: 650;
  }

  h2 {
    margin-bottom: 14px;
    font-size: 16px;
    font-weight: 650;
  }

  p {
    margin-top: 6px;
    color: #5e6b73;
  }

  .badge {
    display: inline-flex;
    min-width: 44px;
    justify-content: center;
    border: 1px solid #2b6f54;
    border-radius: 6px;
    padding: 5px 9px;
    color: #20543f;
    background: #e7f4ee;
    font-size: 13px;
    font-weight: 650;
    text-transform: uppercase;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    margin-bottom: 14px;
  }

  .panel {
    border: 1px solid #d6dde1;
    border-radius: 8px;
    background: #fff;
    padding: 16px;
  }

  dl {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    margin: 0;
  }

  dt {
    color: #5e6b73;
    font-size: 12px;
  }

  dd {
    margin: 4px 0 0;
    font-size: 22px;
    font-weight: 650;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13px;
  }

  th,
  td {
    border-top: 1px solid #e4e8eb;
    padding: 10px 8px;
    text-align: left;
    vertical-align: top;
  }

  th {
    color: #5e6b73;
    font-size: 12px;
    font-weight: 650;
  }

  .empty {
    color: #5e6b73;
  }

  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 720px) {
    dl {
      grid-template-columns: 1fr;
    }

    .status {
      flex-direction: column;
    }
  }
</style>
