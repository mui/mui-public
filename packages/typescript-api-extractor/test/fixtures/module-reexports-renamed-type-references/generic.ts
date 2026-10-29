export interface Pair<First, Second> {
  first: First;
  second: Second;
}

export interface PairHolder {
  pair: Pair<string, number>;
}
