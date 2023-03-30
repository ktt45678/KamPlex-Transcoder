export function divideFromString(value: string) {
  const splitValue = value.split('/');
  if (splitValue.length < 2) return 0;
  return +splitValue[0] / +splitValue[1];
}