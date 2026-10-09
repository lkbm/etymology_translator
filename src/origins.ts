import type { EtymologyOrigin } from './etymologyDict';

// Display order for the legend and for synonym groups
export const ORIGIN_LABELS: Record<EtymologyOrigin, string> = {
	latin: 'Latin',
	greek: 'Greek',
	'anglo-saxon': 'Anglo-Saxon',
	'old-norse': 'Old Norse',
	french: 'French',
	germanic: 'Germanic',
	celtic: 'Celtic',
	unknown: 'Unknown',
};

export const ORIGIN_ORDER = Object.keys(ORIGIN_LABELS) as EtymologyOrigin[];
