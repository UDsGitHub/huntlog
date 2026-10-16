/** The `inert` attribute as a spreadable prop: React 18 doesn't know the property yet. */
export const inert = (on: boolean) => (on ? ({ inert: '' } as object) : {});
