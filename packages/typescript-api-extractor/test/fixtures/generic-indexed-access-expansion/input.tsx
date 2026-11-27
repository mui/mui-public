// An indexed access TypeScript defers because its object or index is generic is documented as
// the union of the members its constraint selects, each with its own properties.

type GaugeKind = 'arc' | 'bar';

interface GaugeConfigs {
	arc: { kind: 'arc'; startAngle?: number; nested: { label: string; arcOnly?: boolean } };
	bar: { kind: 'bar'; thickness?: number; nested: { label: string; barOnly?: boolean } };
}

// The alias keeps its name and type parameters.
export type GaugeConfig<K extends GaugeKind = GaugeKind> = GaugeConfigs[K];

export interface GaugeProps<K extends GaugeKind = GaugeKind> {
	config: GaugeConfigs[K];
	named: GaugeConfig<K>;
	// A lib wrapper around a project lookup map is still the project's.
	required: Required<GaugeConfigs>[K];
	nested: GaugeConfigs[K]['nested'];
	withExtra: (GaugeConfigs & { extra: { kind: 'extra'; extraOnly?: string } })[K | 'extra'];
}

// A type argument selects only the members it names.
type KeyedGauge<K extends GaugeKind> = {
	keys: keyof GaugeConfigs[K];
	config: GaugeConfigs[K];
};

export interface ArcGaugeProps {
	arc: KeyedGauge<'arc'>;
}

// A `keyof` type argument binds the alias's type parameter where its body is replayed.
type GaugeOf<K extends GaugeKind> = { config: GaugeConfigs[K]; keys: keyof GaugeConfigs[K] };

export interface ArcOnlyProps {
	arc: GaugeOf<keyof { arc: 0 }>;
}
