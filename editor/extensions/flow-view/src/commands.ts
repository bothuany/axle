/*---------------------------------------------------------------------------------------------
 *  Insilode: ids of the commands that more than one file runs or registers.
 *--------------------------------------------------------------------------------------------*/

export const Command = {
	/** (id, label, source?) draw the flow of an endpoint or method, whichever backend owns it. */
	showEntry: 'flow.showEntry',
	/** (id, label) the Roslyn spelling of the same, kept for flows remembered by older versions. */
	showMethod: 'flow.showMethod',
	/** (target, label) draw the flow of an explicit target (the language-server path). */
	showTarget: 'flow.showTarget',
	askAgent: 'flow.askAgent',
} as const;
