import * as React from 'react';

// The default `shouldResolveObject` property-count limit keeps the parser from
// expanding large shapes that nobody asked about. It must not apply to the
// shapes a caller did ask about - the exported alias and the component props
// below - because dropping their properties silently empties the output.

interface ManyProps {
	p01: string;
	p02: string;
	p03: string;
	p04: string;
	p05: string;
	p06: string;
	p07: string;
	p08: string;
	p09: string;
	p10: string;
	p11: string;
	p12: string;
	p13: string;
	p14: string;
	p15: string;
	p16: string;
	p17: string;
	p18: string;
	p19: string;
	p20: string;
	p21: string;
	p22: string;
	p23: string;
	p24: string;
	p25: string;
	p26: string;
	p27: string;
	p28: string;
	p29: string;
	p30: string;
	p31: string;
	p32: string;
	p33: string;
	p34: string;
	p35: string;
	p36: string;
	p37: string;
	p38: string;
	p39: string;
	p40: string;
	p41: string;
	p42: string;
	p43: string;
	p44: string;
	p45: string;
	p46: string;
	p47: string;
	p48: string;
	p49: string;
	p50: string;
	p51: string;
}

interface ManyNestedProps {
	n01: string;
	n02: string;
	n03: string;
	n04: string;
	n05: string;
	n06: string;
	n07: string;
	n08: string;
	n09: string;
	n10: string;
	n11: string;
	n12: string;
	n13: string;
	n14: string;
	n15: string;
	n16: string;
	n17: string;
	n18: string;
	n19: string;
	n20: string;
	n21: string;
	n22: string;
	n23: string;
	n24: string;
	n25: string;
	n26: string;
	n27: string;
	n28: string;
	n29: string;
	n30: string;
	n31: string;
	n32: string;
	n33: string;
	n34: string;
	n35: string;
	n36: string;
	n37: string;
	n38: string;
	n39: string;
	n40: string;
	n41: string;
	n42: string;
	n43: string;
	n44: string;
	n45: string;
	n46: string;
	n47: string;
	n48: string;
	n49: string;
	n50: string;
	n51: string;
}

interface ExtraProps {
	extra?: boolean;
	/**
	 * A property value is a nested detail rather than the subject of the export,
	 * so the property-count limit still collapses it to a bare object.
	 */
	nested?: ManyNestedProps;
}

/**
 * Aggregates more than 50 properties through composition alone. Real-world
 * component props reach the same shape through wrappers such as
 * `Omit<Partial<ManyProps> & ExtraProps, 'p51'>`.
 */
export type ManyComponentProps = ManyProps &
	ExtraProps & {
		forced?: true;
	};

/**
 * A component whose props exceed the default property-count limit.
 */
export function ManyPropsComponent(props: ManyComponentProps): React.JSX.Element {
	return <div>{props.p01}</div>;
}
