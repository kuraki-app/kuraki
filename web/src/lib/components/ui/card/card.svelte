<script lang="ts">
	import type { HTMLAttributes } from "svelte/elements";
	import { cn, type WithElementRef } from "$lib/utils.js";

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = "default",
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & { size?: "default" | "sm" } = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	data-size={size}
	class={cn("bg-card text-card-foreground gap-(--card-spacing) overflow-hidden rounded-[var(--frame-radius)] border border-[var(--frame-border-color)] py-(--card-spacing) text-sm shadow-[var(--frame-shadow)] [--card-spacing:calc(var(--space-step)*3)] has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:calc(var(--space-step)*2)] *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl group/card flex flex-col", className)}
	{...restProps}
>
	{@render children?.()}
</div>
