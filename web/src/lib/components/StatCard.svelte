<script lang="ts">
  // A single figure + its label. Inherits its register from the host page:
  // in the Vault the figure is mono and the label is micro-caps.
  export let value: string | number;
  export let label: string;
</script>

<div class="stat">
  <strong class="stat-value">{value}</strong>
  <span class="stat-label">{label}</span>
</div>

<style>
  .stat {
    display: grid;
    gap: var(--space-step);
    padding: calc(var(--space-step) * 3);
    border: 1px solid var(--frame-border-color);
    border-radius: var(--frame-radius);
    background: var(--card);
    box-shadow: var(--frame-shadow);
  }
  .stat-value {
    color: var(--card-foreground);
    font-family: var(--frame-data-font);
    font-size: 24px;
    font-weight: 700;
    /* Figures in a column must not jitter as digits change. */
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  .stat-label {
    color: var(--muted-foreground);
    font-family: var(--frame-label-font);
    font-size: var(--frame-label-size);
    letter-spacing: var(--frame-label-tracking);
    text-transform: var(--frame-label-transform);
  }
</style>
