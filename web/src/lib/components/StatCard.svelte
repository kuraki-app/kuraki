<script lang="ts">
  export let value: string | number;
  export let label: string;
</script>

<div class="grid gap-1 rounded-xl border bg-card p-4">
  <strong class="text-2xl font-bold text-card-foreground">{value}</strong>
  <span class="text-[13px] text-muted-foreground">{label}</span>
</div>
