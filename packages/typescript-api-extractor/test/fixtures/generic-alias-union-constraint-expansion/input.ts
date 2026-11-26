// Simplified from the MUI X Charts `AxisConfig` pattern: a generic alias whose type parameters are
// constrained to unions, where each constraint member brings different properties.
// Records how the generic export and its default instantiation (`ChartProps.xAxis`) are documented.

type ScaleName = 'band' | 'linear';

interface AxisScaleConfig {
	band: { scaleType: 'band'; categoryGapRatio?: number };
	linear: { scaleType: 'linear'; min?: number };
}

interface XAxisProps {
	axis: 'x';
	tickHeight?: number;
}

interface YAxisProps {
	axis: 'y';
	tickWidth?: number;
}

export type AxisConfig<
	S extends ScaleName = ScaleName,
	AxisProps extends XAxisProps | YAxisProps = XAxisProps | YAxisProps,
> = { id: string } & AxisScaleConfig[S] &
	(AxisProps extends XAxisProps ? { tickLabelMinGap?: number } : {}) &
	AxisProps;

export interface ChartProps {
	xAxis?: AxisConfig[];
}
