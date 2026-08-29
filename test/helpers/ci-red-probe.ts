// Deliberate type error. Nothing imports this, so jest never loads it and only tsc can see it.
export const deliberatelyWrong: number = 'a string, not a number';
